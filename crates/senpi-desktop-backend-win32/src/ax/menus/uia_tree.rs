//! Bounded MenuBar/Menu/MenuItem discovery, excluding arbitrary controls.

use senpi_desktop_core::error::CoreResult;
use senpi_desktop_core::menus::MenuItem;
use uiautomation::{
    patterns::{UIExpandCollapsePattern, UILegacyIAccessiblePattern, UITogglePattern},
    types::{ControlType, ExpandCollapseState, Handle, ToggleState},
    UIElement,
};
use windows_sys::Win32::Foundation::E_POINTER;

use super::super::uia_error;
use super::uia::{unexposed, Level, UiaMenus};
use crate::menus::{failed, MAX_ITEMS, MAX_LABEL_UNITS, MAX_UIA_DEPTH};

impl UiaMenus<'_> {
    fn children(&mut self, element: &UIElement) -> CoreResult<Vec<UIElement>> {
        (self.stop)()?;
        let mut result = Vec::new();
        let mut next = self.walker.get_first_child(element);
        loop {
            let child = match next {
                Ok(child) => child,
                // A walker reports "no further element" as a successful null
                // interface, which windows-rs surfaces as an error whose code
                // is S_OK (older releases: E_POINTER).
                Err(error) if error.code() == 0 || error.code() == E_POINTER => break,
                Err(error) => return Err(uia_error(error)),
            };
            if self.remaining == 0 || result.len() == MAX_ITEMS {
                return Err(failed("UIA menu discovery exceeded its bounded node limit"));
            }
            self.remaining -= 1;
            (self.stop)()?;
            next = self.walker.get_next_sibling(&child);
            result.push(child);
        }
        Ok(result)
    }

    pub(super) fn menu_bar(&mut self) -> CoreResult<UIElement> {
        let root = self
            .automation
            .element_from_handle(Handle::from(self.target.hwnd.addr() as isize))
            .map_err(uia_error)?;
        self.owns(&root)?;
        let mut pending = vec![(root, 0)];
        let mut found = None;
        while let Some((element, depth)) = pending.pop() {
            for child in self.children(&element)? {
                match child.get_control_type().map_err(uia_error)? {
                    ControlType::MenuBar => {
                        self.owns(&child)?;
                        if found.is_some() {
                            return Err(failed("the exact window exposes multiple UIA menu bars; refusing ambiguity"));
                        }
                        found = Some(child);
                    }
                    ControlType::Pane | ControlType::Group | ControlType::Custom => {
                        if depth == MAX_UIA_DEPTH {
                            return Err(failed(
                                "UIA menu-bar discovery exceeded its bounded depth limit",
                            ));
                        }
                        self.owns(&child)?;
                        pending.push((child, depth + 1));
                    }
                    _ => {}
                }
            }
        }
        found.ok_or_else(unexposed)
    }

    fn menu_children(
        &mut self,
        parent: &UIElement,
        depth: usize,
        output: &mut Vec<UIElement>,
    ) -> CoreResult<()> {
        if depth > MAX_UIA_DEPTH {
            return Err(failed(
                "UIA submenu nesting exceeds its bounded depth limit",
            ));
        }
        self.owns(parent)?;
        for child in self.children(parent)? {
            match child.get_control_type().map_err(uia_error)? {
                ControlType::MenuItem => {
                    self.owns(&child)?;
                    if output.len() == MAX_ITEMS {
                        return Err(failed("UIA menu exceeds its bounded item limit"));
                    }
                    output.push(child);
                }
                ControlType::Menu => self.menu_children(&child, depth + 1, output)?,
                _ => {}
            }
        }
        Ok(())
    }

    pub(super) fn describe(
        &mut self,
        element: &UIElement,
        path: &[String],
    ) -> CoreResult<MenuItem> {
        self.owns(element)?;
        let title = element.get_name().map_err(uia_error)?;
        if title.len() > MAX_LABEL_UNITS * 4 {
            return Err(failed("UIA menu label exceeds the bounded text limit"));
        }
        let legacy = element.get_pattern::<UILegacyIAccessiblePattern>().ok();
        let state = legacy
            .as_ref()
            .map(|pattern| pattern.get_state().map_err(uia_error))
            .transpose()?
            .unwrap_or(0);
        let expandable = element
            .get_pattern::<UIExpandCollapsePattern>()
            .ok()
            .map(|pattern| pattern.get_state().map_err(uia_error))
            .transpose()?
            .is_some_and(|state| state != ExpandCollapseState::LeafNode);
        let checked = if let Ok(pattern) = element.get_pattern::<UITogglePattern>() {
            pattern.get_toggle_state().map_err(uia_error)? == ToggleState::On
        } else {
            state & 0x10 != 0
        };
        let mut has_submenu = expandable || state & 0x4000_0000 != 0;
        if !has_submenu {
            for child in self.children(element)? {
                if matches!(
                    child.get_control_type().map_err(uia_error)?,
                    ControlType::Menu | ControlType::MenuItem
                ) {
                    has_submenu = true;
                    break;
                }
            }
        }
        let shortcut = element.get_accelerator_key().map_err(uia_error)?;
        let mut item_path = path.to_vec();
        item_path.push(title.clone());
        Ok(MenuItem {
            title,
            path: item_path,
            enabled: element.is_enabled().map_err(uia_error)? && state & 1 == 0,
            checked,
            has_submenu,
            shortcut: (!shortcut.trim().is_empty()).then_some(shortcut),
        })
    }

    pub(super) fn level(&mut self, parent: &UIElement, path: &[String]) -> CoreResult<Level> {
        let mut elements = Vec::new();
        self.menu_children(parent, 0, &mut elements)?;
        let mut items = Vec::with_capacity(elements.len());
        for element in &elements {
            items.push(self.describe(element, path)?);
        }
        Ok(Level { items, elements })
    }
}
