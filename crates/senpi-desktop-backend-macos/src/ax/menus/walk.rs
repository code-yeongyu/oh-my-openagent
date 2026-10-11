//! Resolving a window to its menu tree and walking it: the owning app
//! element, the menu bar, per-level child listing, and the submenu choice.

use std::ptr::NonNull;

use objc2_application_services::{AXError, AXUIElement};
use objc2_core_foundation::{CFArray, CFRetained, CFString, CFType};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::menus::{match_index, require_enabled, MenuItem};
use senpi_desktop_core::types::DesktopWindow;

use super::super::{element, tree};
use super::describe::describe;

const MAX_MENU_CHILDREN: usize = 4096;

/// The window's owning app element, its pid, and its CGWindowID; refuses when
/// the exact native window cannot be proven by id.
pub(super) fn context(window: &DesktopWindow) -> CoreResult<(CFRetained<AXUIElement>, libc::pid_t, u32)> {
    let wid = window
        .id
        .parse::<u32>()
        .map_err(|_| DesktopError::invalid_target("invalid macOS menu window id"))?;
    let root = tree::window_root(window)?;
    if element::window_id(&root) != Some(wid) {
        return Err(DesktopError::background_unavailable(
            "cannot prove the exact native window for this menu; macOS window-id accessibility \
             support is required",
        ));
    }
    let pid = element_pid(&root)?;
    let app = element::create_application(pid)?;
    element::set_timeout(&app)?;
    Ok((app, pid, wid))
}

pub(super) fn element_pid(element: &AXUIElement) -> CoreResult<libc::pid_t> {
    let mut pid = 0;
    // SAFETY: `pid` is writable and the retained element outlives the query.
    let error = unsafe { element.pid(NonNull::from(&mut pid)) };
    if error != AXError::Success {
        return Err(DesktopError::ax_failed(format!(
            "reading AX element owner failed ({error:?})"
        )));
    }
    if pid <= 0 {
        return Err(DesktopError::ax_failed("AX element has no application owner"));
    }
    Ok(pid)
}

/// Walks `path` submenu by submenu from the app's menu bar, calling
/// `check_stop` at each level and refusing a disabled submenu before descent.
pub(super) fn resolve_menu(
    app: &AXUIElement,
    path: &[String],
    pid: libc::pid_t,
    check_stop: &dyn Fn() -> CoreResult<()>,
) -> CoreResult<(CFRetained<AXUIElement>, Vec<String>)> {
    let mut menu = element::copy_element(app, "AXMenuBar")
        .ok_or_else(|| DesktopError::ax_failed("application does not expose AXMenuBar"))?;
    let mut actual_path = Vec::with_capacity(path.len());
    for label in path {
        check_stop()?;
        let (elements, items) = children(&menu, &actual_path, pid, check_stop)?;
        let index = match_index(&items, label)?;
        require_enabled(&items[index])?;
        menu = match submenu_element(&elements[index])? {
            Some(submenu) => submenu,
            None => {
                return Err(DesktopError::ax_failed(format!(
                    "menu item '{}' does not expose a submenu",
                    items[index].title
                )))
            }
        };
        actual_path.push(items[index].title.clone());
    }
    Ok((menu, actual_path))
}

/// The titled `AXMenuItem`/`AXMenuBarItem` children of `menu`, with their
/// elements, capped at 4096 and same-pid enforced.
pub(super) fn children(
    menu: &AXUIElement,
    path: &[String],
    pid: libc::pid_t,
    check_stop: &dyn Fn() -> CoreResult<()>,
) -> CoreResult<(Vec<CFRetained<AXUIElement>>, Vec<MenuItem>)> {
    check_stop()?;
    if element_pid(menu)? != pid {
        return Err(DesktopError::ax_failed("menu belongs to a different application"));
    }
    let children = bounded_children(menu, false)?;
    let mut elements = Vec::with_capacity(children.len());
    let mut items = Vec::with_capacity(children.len());
    for child in children {
        check_stop()?;
        let role = required_string(&child, "AXRole")?;
        if matches!(role.as_str(), "AXMenuItem" | "AXMenuBarItem") {
            let item = describe(&child, path, pid)?;
            if !item.title.is_empty() {
                elements.push(child);
                items.push(item);
            }
        }
    }
    Ok((elements, items))
}

pub(super) fn required_string(element: &AXUIElement, attribute: &str) -> CoreResult<String> {
    let value = element::copy_attribute_result(element, attribute)
        .map_err(|error| DesktopError::ax_failed(format!("copying {attribute} failed ({error:?})")))?
        .ok_or_else(|| DesktopError::ax_failed(format!("copying {attribute} returned no value")))?;
    value
        .downcast::<CFString>()
        .map(|value| value.to_string())
        .map_err(|_| DesktopError::ax_failed(format!("{attribute} was not a string")))
}

/// `optional` treats only "no value" / "unsupported" as no children; any
/// other AX failure is an error, so a failed read never looks like an empty
/// menu.
fn bounded_children(element: &AXUIElement, optional: bool) -> CoreResult<Vec<CFRetained<AXUIElement>>> {
    let value = match element::copy_attribute_result(element, "AXChildren") {
        Ok(Some(value)) => value,
        Ok(None) | Err(AXError::NoValue | AXError::AttributeUnsupported) if optional => return Ok(Vec::new()),
        other => {
            return Err(DesktopError::ax_failed(format!(
                "reading native menu children failed: {other:?}"
            )))
        }
    };
    let array = value
        .downcast::<CFArray>()
        .map_err(|_| DesktopError::ax_failed("native menu children were not an array"))?;
    // SAFETY: AXChildren is an immutable Copy-rule array of CF objects; each
    // element is checked to be an AXUIElement below.
    let array = unsafe { CFRetained::cast_unchecked::<CFArray<CFType>>(array) };
    if array.len() > MAX_MENU_CHILDREN {
        return Err(DesktopError::ax_failed(
            "native menu exceeds the 4096-child safety limit; refusing incomplete matching",
        ));
    }
    array
        .iter()
        .map(|child| {
            child
                .downcast::<AXUIElement>()
                .map_err(|_| DesktopError::ax_failed("native menu children contained a non-accessibility object"))
        })
        .collect()
}

/// The single `AXMenu` child of `element`, or `None` when there is no
/// submenu; a second `AXMenu` child is ambiguous and refused.
pub(super) fn submenu_element(element: &AXUIElement) -> CoreResult<Option<CFRetained<AXUIElement>>> {
    let children = bounded_children(element, true)?;
    let mut roles = Vec::with_capacity(children.len());
    for child in &children {
        roles.push(required_string(child, "AXRole")?);
    }
    match pick_submenu_index(&roles)? {
        Some(index) => Ok(Some(children[index].clone())),
        None => Ok(None),
    }
}

pub(super) fn pick_submenu_index(roles: &[String]) -> CoreResult<Option<usize>> {
    let mut found = None;
    for (index, role) in roles.iter().enumerate() {
        if role == "AXMenu" {
            if found.is_some() {
                return Err(DesktopError::ax_failed(
                    "menu item exposes multiple submenus; refusing ambiguous traversal",
                ));
            }
            found = Some(index);
        }
    }
    Ok(found)
}
