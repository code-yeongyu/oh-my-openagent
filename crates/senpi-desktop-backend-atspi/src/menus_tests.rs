//! Menu listing and selection over the in-memory bus: the GTK-shaped tree
//! below, and what reached the bus (`calls`) for every refusal.

use atspi::{Interface, Role, State};
use senpi_desktop_core::error::{CoreResult, DesktopError, ErrorCode};
use senpi_desktop_core::types::DesktopWindow;

use crate::fake::{editor, FakeBus, FakeNode, EDITOR_RECT};
use crate::menu_target::MenuTarget;
use crate::menus::{accelerator, command_index, items, select};
use crate::WindowIds;

pub(crate) fn window() -> DesktopWindow {
    DesktopWindow {
        id: "atspi::1.10:/org/a11y/atspi/accessible/10".into(),
        title: "notes.txt - gedit".into(),
        app: "gedit".into(),
        pid: Some(4242),
        x: EDITOR_RECT.x,
        y: EDITOR_RECT.y,
        width: EDITOR_RECT.width.unsigned_abs(),
        height: EDITOR_RECT.height.unsigned_abs(),
        focused: true,
        elevated: None,
        is_on_screen: None,
    }
}

pub(crate) fn command(name: &str) -> FakeNode {
    let mut item = FakeNode::new(Role::MenuItem, name);
    item.state.insert(State::Sensitive);
    item.interfaces.insert(Interface::Action);
    item.actions = vec!["click".into()];
    item
}

pub(crate) fn submenu(name: &str) -> FakeNode {
    let mut menu = FakeNode::new(Role::Menu, name);
    menu.state.insert(State::Sensitive);
    menu
}

/// The editor (frame 10) with a filler (20) holding a menu bar (30):
/// File (40) = Open… (41), separator (42), Save (43, Ctrl+S), Recent (44)
/// wrapping an unnamed Menu (45) around a.txt (46); Edit (50) = disabled Undo (51).
pub(crate) fn menus() -> FakeBus {
    let mut bus = editor();
    bus.add(20, 10, FakeNode::new(Role::Filler, ""));
    bus.add(30, 20, FakeNode::new(Role::MenuBar, ""));
    bus.add(40, 30, submenu("File"));
    bus.add(41, 40, command("Open…"));
    bus.add(42, 40, FakeNode::new(Role::Separator, ""));
    let mut save = command("Save");
    save.key_binding = "s;<Alt>f:s;<Primary>s".into();
    bus.add(43, 40, save);
    bus.add(44, 40, submenu("Recent"));
    bus.add(45, 44, FakeNode::new(Role::Menu, ""));
    bus.add(46, 45, command("a.txt"));
    bus.add(50, 30, submenu("Edit"));
    let mut undo = command("Undo");
    undo.state.remove(State::Sensitive);
    bus.add(51, 50, undo);
    bus
}

/// The menu request for `window`, whose id is an AT-SPI frame id.
pub(crate) fn on(window: &DesktopWindow) -> MenuTarget<'_> {
    MenuTarget {
        window,
        ids: WindowIds::AtSpiFrames,
        windows: &[],
    }
}

pub(crate) fn path(labels: &[&str]) -> Vec<String> {
    labels.iter().map(|label| (*label).to_string()).collect()
}

/// A window list that reads the same again, as when nothing closed.
pub(crate) fn unchanged() -> CoreResult<Vec<DesktopWindow>> {
    Ok(Vec::new())
}

pub(crate) fn no_stop() -> CoreResult<()> {
    Ok(())
}

pub(crate) fn actions(bus: &FakeBus) -> Vec<&String> {
    bus.calls.iter().filter(|call| call.starts_with("action")).collect()
}

fn titles(listed: &[senpi_desktop_core::menus::MenuItem]) -> Vec<&str> {
    listed.iter().map(|item| item.title.as_str()).collect()
}

#[test]
fn the_menu_bar_lists_its_top_level_menus_as_submenus() {
    let mut bus = menus();
    let listed = items(&mut bus, on(&window()), &[]).unwrap();
    assert_eq!(titles(&listed), ["File", "Edit"]);
    assert!(listed.iter().all(|item| item.has_submenu && item.enabled));
}

#[test]
fn a_menu_lists_its_items_without_separators_and_with_their_shortcuts() {
    let mut bus = menus();
    let listed = items(&mut bus, on(&window()), &path(&["file"])).unwrap();
    assert_eq!(titles(&listed), ["Open…", "Save", "Recent"]);
    assert_eq!(listed[1].path, path(&["File", "Save"]));
    assert_eq!(listed[1].shortcut.as_deref(), Some("<Primary>s"));
    assert!(listed[2].has_submenu);
}

#[test]
fn a_submenu_wrapped_in_an_unnamed_menu_lists_through_the_wrapper() {
    let mut bus = menus();
    let listed = items(&mut bus, on(&window()), &path(&["File", "Recent"])).unwrap();
    assert_eq!(titles(&listed), ["a.txt"]);
}

#[test]
fn selecting_a_command_runs_its_declared_action_once() {
    let mut bus = menus();
    select(&mut bus, on(&window()), &unchanged, &path(&["File", "Save"]), &no_stop).unwrap();
    assert_eq!(actions(&bus), ["action 43 #0"]);
}

#[test]
fn a_label_without_its_trailing_ellipsis_selects_the_item() {
    let mut bus = menus();
    select(&mut bus, on(&window()), &unchanged, &path(&["File", "Open"]), &no_stop).unwrap();
    assert_eq!(actions(&bus), ["action 41 #0"]);
}

#[test]
fn an_ambiguous_label_is_refused_and_runs_nothing() {
    let mut bus = menus();
    bus.add(47, 40, command("save"));
    let error = select(&mut bus, on(&window()), &unchanged, &path(&["File", "Save"]), &no_stop).unwrap_err();
    assert!(error.message.contains("ambiguous"), "{}", error.message);
    assert!(actions(&bus).is_empty());
}

#[test]
fn a_disabled_command_is_refused_and_runs_nothing() {
    let mut bus = menus();
    let error = select(&mut bus, on(&window()), &unchanged, &path(&["Edit", "Undo"]), &no_stop).unwrap_err();
    assert!(error.message.contains("disabled"), "{}", error.message);
    assert!(actions(&bus).is_empty());
}

#[test]
fn a_submenu_is_not_a_command() {
    let mut bus = menus();
    let error = select(&mut bus, on(&window()), &unchanged, &path(&["File", "Recent"]), &no_stop).unwrap_err();
    assert!(error.message.contains("leaf menu command"), "{}", error.message);
    assert!(actions(&bus).is_empty());
}

#[test]
fn a_child_whose_parent_link_disagrees_is_refused_before_any_action() {
    let mut bus = menus();
    bus.nodes.get_mut(&43).unwrap().parent = 50;
    let error = select(&mut bus, on(&window()), &unchanged, &path(&["File", "Save"]), &no_stop).unwrap_err();
    assert!(error.message.contains("parent ownership"), "{}", error.message);
    assert!(actions(&bus).is_empty());
}

#[test]
fn a_child_from_another_application_is_refused_before_any_action() {
    let mut bus = menus();
    bus.add(2, 0, FakeNode::new(Role::Application, "intruder"));
    let mut foreign = command("Quit");
    foreign.application = 2;
    bus.add(60, 40, foreign);
    let error = select(&mut bus, on(&window()), &unchanged, &path(&["File", "Save"]), &no_stop).unwrap_err();
    assert!(error.message.contains("cross-application"), "{}", error.message);
    assert!(actions(&bus).is_empty());
}

#[test]
fn a_command_without_one_activation_action_is_refused() {
    let mut bus = menus();
    bus.nodes.get_mut(&43).unwrap().actions = vec!["click".into(), "activate".into()];
    let error = select(&mut bus, on(&window()), &unchanged, &path(&["File", "Save"]), &no_stop).unwrap_err();
    assert!(error.message.contains("activation action"), "{}", error.message);
    assert!(actions(&bus).is_empty());
}

#[test]
fn a_stop_before_the_action_runs_nothing() {
    let mut bus = menus();
    let calls = std::cell::Cell::new(0);
    let stop_at_last_check = || {
        calls.set(calls.get() + 1);
        if calls.get() > 4 {
            Err(DesktopError::new(ErrorCode::Suspended, "stopped"))
        } else {
            Ok(())
        }
    };
    let error = select(&mut bus, on(&window()), &unchanged, &path(&["File", "Save"]), &stop_at_last_check).unwrap_err();
    assert_eq!(error.code, ErrorCode::Suspended);
    assert_eq!(calls.get(), 5, "the stop check before the action must be the one that refused");
    assert!(actions(&bus).is_empty());
}

#[test]
fn a_frame_without_a_menu_bar_refuses_listing() {
    let mut bus = editor();
    let error = items(&mut bus, on(&window()), &[]).unwrap_err();
    assert!(error.message.contains("no accessible menu bar"), "{}", error.message);
}

#[test]
fn only_the_accelerator_of_a_key_binding_is_a_shortcut() {
    assert_eq!(accelerator(";;<Primary>s").as_deref(), Some("<Primary>s"));
    assert_eq!(accelerator("o;<Alt>f:o;"), None);
    assert_eq!(accelerator(""), None);
    assert_eq!(accelerator("<Control>q").as_deref(), Some("<Control>q"));
}

#[test]
fn the_command_action_must_be_unique() {
    let names = |list: &[&str]| list.iter().map(|name| (*name).to_string()).collect::<Vec<_>>();
    assert!(command_index(&names(&[])).is_err());
    assert!(command_index(&names(&["show", "focus"])).is_err());
    assert!(command_index(&names(&["press", "PRESS"])).is_err());
    assert_eq!(command_index(&names(&["show", "aCtIvAtE"])).unwrap(), 1);
}
