//! Native application menus over AT-SPI (#9651): the menu bar inside a
//! target frame, listed level by level and selected through the item's own
//! declared activation action, so a menu command runs without focusing or
//! opening anything. Discovery is bounded and fail-closed: a child whose
//! parent link, application, or role does not fit a menu refuses the request
//! instead of being skipped, because a detached popup or another frame's menu
//! must never become the target of a command.

use atspi::{Role, State};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::types::DesktopWindow;
use senpi_desktop_core::menus::{match_index, require_command, require_enabled, validate_path, MenuItem};

use crate::apps::frame_of;
use crate::bus::AtSpiBus;
use crate::menu_target::{bound_root, MenuTarget};

/// Most objects one menu walk reads.
const NODE_LIMIT: usize = 2048;
/// Deepest container nesting searched for a frame's menu bar.
const DEPTH_LIMIT: usize = 32;
/// Action names that run a menu command (compared ignoring ASCII case).
const COMMAND_ACTIONS: [&str; 7] = ["click", "press", "activate", "invoke", "toggle", "check", "uncheck"];

fn failure(message: impl std::fmt::Display) -> DesktopError {
    DesktopError::ax_failed(format!("AT-SPI menu: {message}"))
}

const fn menu_role(role: Role) -> bool {
    matches!(
        role,
        Role::Menu | Role::MenuItem | Role::CheckMenuItem | Role::RadioMenuItem
    )
}

/// The accelerator of an ATK key binding, `<mnemonic>;<keyboard path>;<accelerator>`;
/// a bare mnemonic or menu path is not a shortcut the user can press.
pub(crate) fn accelerator(binding: &str) -> Option<String> {
    let fields: Vec<&str> = binding.split(';').collect();
    let accelerator = match fields.as_slice() {
        [only] => only.trim(),
        [_, _, accelerator, ..] => accelerator.trim(),
        _ => "",
    };
    (!accelerator.is_empty()).then(|| accelerator.to_owned())
}

/// The one declared action that activates a command: none, or more than one,
/// refuses rather than guessing which action the toolkit means.
pub(crate) fn command_index(names: &[String]) -> CoreResult<i32> {
    let mut candidates = names.iter().enumerate().filter(|(_, name)| {
        COMMAND_ACTIONS
            .iter()
            .any(|command| name.eq_ignore_ascii_case(command))
    });
    match (candidates.next(), candidates.next()) {
        (Some((index, _)), None) => i32::try_from(index).map_err(failure),
        _ => Err(failure("command has no unique declared activation action")),
    }
}

fn same<B: AtSpiBus>(bus: &B, a: &B::Node, b: &B::Node) -> bool {
    bus.object_id(a) == bus.object_id(b)
}

/// `object`'s children, each proven to name `object` as its parent and to
/// belong to the same application.
fn menu_children<B: AtSpiBus>(bus: &mut B, object: &B::Node) -> CoreResult<Vec<B::Node>> {
    let children = bus.children(object).map_err(failure)?;
    if children.len() > NODE_LIMIT {
        return Err(failure("child limit exceeded"));
    }
    for child in &children {
        if bus.is_null(child) || same(bus, child, object) || !bus.same_application(child, object) {
            return Err(failure("invalid or cross-application child ownership"));
        }
        let parent = bus.parent(child).map_err(failure)?;
        if !same(bus, &parent, object) {
            return Err(failure("menu child has inconsistent parent ownership"));
        }
    }
    Ok(children)
}

/// The menu bars inside `root`, found through layout containers only: menus
/// are chrome, not document content, and a nested frame is another target.
fn menu_bars<B: AtSpiBus>(bus: &mut B, root: &B::Node) -> CoreResult<Vec<B::Node>> {
    let mut pending = vec![(root.clone(), 0)];
    let mut seen: Vec<String> = Vec::new();
    let mut bars = Vec::new();
    while let Some((object, depth)) = pending.pop() {
        let id = bus.object_id(&object);
        if depth > DEPTH_LIMIT || seen.len() >= NODE_LIMIT || seen.contains(&id) {
            return Err(failure("menu discovery exceeded its bounded tree or found a cycle"));
        }
        seen.push(id);
        let role = bus.role(&object).map_err(failure)?;
        if role == Role::MenuBar {
            bars.push(object);
            continue;
        }
        let container = matches!(
            role,
            Role::Panel | Role::Filler | Role::RootPane | Role::LayeredPane
        );
        if depth > 0 && !container {
            continue;
        }
        let children = menu_children(bus, &object)?;
        if pending.len() + seen.len() + children.len() > NODE_LIMIT {
            return Err(failure("menu discovery node limit exceeded"));
        }
        pending.extend(children.into_iter().map(|child| (child, depth + 1)));
    }
    if bars.is_empty() {
        return Err(failure(
            "target frame exposes no accessible menu bar; global or detached menus are not target-bound",
        ));
    }
    Ok(bars)
}

/// The items directly under `containers`, with separators dropped. A submenu
/// a toolkit wraps in one intermediate unnamed (or same-named) `Menu` object
/// is listed through that wrapper.
fn menu_level<B: AtSpiBus>(
    bus: &mut B,
    containers: &[B::Node],
    path: &[String],
) -> CoreResult<(Vec<MenuItem>, Vec<B::Node>)> {
    let mut items = Vec::new();
    let mut objects = Vec::new();
    for container in containers {
        let owner_role = bus.role(container).map_err(failure)?;
        let owner_name = bus.name(container).map_err(failure)?;
        let mut children = menu_children(bus, container)?;
        if owner_role != Role::MenuBar && children.len() == 1 {
            let name = bus.name(&children[0]).map_err(failure)?;
            if bus.role(&children[0]).map_err(failure)? == Role::Menu && (name.is_empty() || name == owner_name) {
                children = menu_children(bus, &children[0])?;
            }
        }
        for object in children {
            if objects.len() >= NODE_LIMIT {
                return Err(failure("menu item limit exceeded"));
            }
            let role = bus.role(&object).map_err(failure)?;
            if role == Role::Separator {
                continue;
            }
            if !menu_role(role) {
                return Err(failure("menu contains an unsupported non-menu child"));
            }
            let title = bus.name(&object).map_err(failure)?;
            let state = bus.state(&object).map_err(failure)?;
            if state.contains(State::Defunct) {
                return Err(failure("menu item is defunct"));
            }
            let mut has_submenu = role == Role::Menu;
            for child in menu_children(bus, &object)? {
                has_submenu |= menu_role(bus.role(&child).map_err(failure)?);
            }
            let shortcut = bus.key_binding(&object, 0).ok().and_then(|binding| accelerator(&binding));
            let mut item_path = path.to_vec();
            item_path.push(title.clone());
            items.push(MenuItem {
                title,
                path: item_path,
                enabled: state.contains(State::Enabled) && state.contains(State::Sensitive),
                checked: state.contains(State::Checked),
                has_submenu,
                shortcut,
            });
            objects.push(object);
        }
    }
    if items.is_empty() {
        return Err(failure(
            "menu children are absent or inaccessible without opening a foreground popup",
        ));
    }
    Ok((items, objects))
}

/// Walks `path` from the frame's menu bars, refusing a disabled item on the
/// way and a command used as a submenu, and checking for a stop at each level.
fn resolve<B: AtSpiBus>(
    bus: &mut B,
    root: &B::Node,
    path: &[String],
    check_stop: &dyn Fn() -> CoreResult<()>,
) -> CoreResult<(MenuItem, B::Node)> {
    let mut containers = menu_bars(bus, root)?;
    let mut canonical = Vec::new();
    for (depth, label) in path.iter().enumerate() {
        check_stop()?;
        let (mut items, mut objects) = menu_level(bus, &containers, &canonical)?;
        let index = match_index(&items, label)?;
        let item = items.swap_remove(index);
        require_enabled(&item)?;
        let object = objects.swap_remove(index);
        if depth + 1 == path.len() {
            return Ok((item, object));
        }
        if !item.has_submenu {
            return Err(failure("path traverses a command rather than a submenu"));
        }
        canonical = item.path;
        containers = vec![object];
    }
    Err(failure("a menu path is required"))
}

/// The items of the target window's menu bar (empty `path`) or of the submenu `path`
/// names.
pub(crate) fn items<B: AtSpiBus>(bus: &mut B, target: MenuTarget<'_>, path: &[String]) -> CoreResult<Vec<MenuItem>> {
    validate_path(path, true)?;
    let root = bound_root(bus, target)?;
    let (containers, canonical) = if path.is_empty() {
        (menu_bars(bus, &root)?, Vec::new())
    } else {
        let (item, object) = resolve(bus, &root, path, &|| Ok(()))?;
        if !item.has_submenu {
            return Err(failure("requested item is not a submenu"));
        }
        (vec![object], item.path)
    };
    menu_level(bus, &containers, &canonical).map(|(items, _)| items)
}

/// Runs the command `path` names in the target window's menu. The frame, the command's
/// ownership, and the path are proven again after discovery, against a window
/// list read again by `relist` so a target that closed meanwhile is refused,
/// and the stop check runs immediately before the action.
pub(crate) fn select<B: AtSpiBus>(
    bus: &mut B,
    target: MenuTarget<'_>,
    relist: &dyn Fn() -> CoreResult<Vec<DesktopWindow>>,
    path: &[String],
    check_stop: &dyn Fn() -> CoreResult<()>,
) -> CoreResult<()> {
    validate_path(path, false)?;
    let root = bound_root(bus, target)?;
    let (item, object) = resolve(bus, &root, path, check_stop)?;
    require_command(&item)?;
    let windows = relist()?;
    let current_root = bound_root(bus, MenuTarget { windows: &windows, ..target })?;
    if !same(bus, &current_root, &root) {
        return Err(failure("target frame changed during menu discovery"));
    }
    if !frame_of(bus, &object)?.is_some_and(|frame| same(bus, &frame, &root)) {
        return Err(failure("command no longer belongs to the target frame"));
    }
    let (current, current_object) = resolve(bus, &root, path, check_stop)?;
    require_command(&current)?;
    if !same(bus, &current_object, &object) {
        return Err(failure("menu command changed during discovery"));
    }
    let actions = bus.actions(&object).map_err(failure)?;
    let index = command_index(&actions)?;
    check_stop()?;
    if bus.do_action(&object, index).map_err(failure)? {
        Ok(())
    } else {
        Err(failure("application refused the menu command"))
    }
}
