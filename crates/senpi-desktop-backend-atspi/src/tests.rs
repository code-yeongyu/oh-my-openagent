//! Unit tests over the in-memory proxy shim (`FakeBus`): every decision the
//! backend takes above the D-Bus round trips, without an accessibility bus.

use atspi::Role;
use senpi_desktop_core::ax::{snapshot, AxBackend, AxBounds, AxHandle, AxRegistry};
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::types::{AxSnapshotOptions, DesktopWindow};

use crate::bus::Extents;
use crate::fake::{editor, node, FakeBus, FakeNode, EDITOR_RECT};
use crate::{AtSpiAx, AxPermission};

/// A window over the editor's frame rect.
fn window(app: &str, title: &str, pid: Option<u32>) -> DesktopWindow {
    DesktopWindow {
        id: "0x2a".into(),
        title: title.into(),
        app: app.into(),
        pid,
        x: EDITOR_RECT.x,
        y: EDITOR_RECT.y,
        width: 640,
        height: 480,
        focused: false,
        elevated: None,
    }
}

fn root_id(ax: &mut AtSpiAx<FakeBus>, win: &DesktopWindow) -> u64 {
    *ax.window_root(win).unwrap().downcast_native::<u64>().unwrap()
}

#[test]
fn windows_lists_frames_with_pid_and_skips_popups() {
    // Given an editor plus a 10 px tooltip frame
    let mut bus = editor();
    bus.add(
        13,
        1,
        FakeNode::frame(
            "tip",
            Extents {
                x: 0,
                y: 0,
                width: 10,
                height: 10,
            },
        ),
    );
    // When the windows are listed
    let windows = AtSpiAx::with_bus(bus).windows().unwrap();
    // Then only the real frame is a window, with the app's pid and its rect
    assert_eq!(windows.len(), 1);
    let listed = &windows[0];
    assert_eq!(listed.id, "atspi::1.10:/org/a11y/atspi/accessible/10");
    assert_eq!((listed.app.as_str(), listed.pid), ("gedit", Some(4242)));
    assert_eq!(
        (listed.x, listed.y, listed.width, listed.height),
        (10, 20, 640, 480)
    );
}

#[test]
fn windows_stop_at_the_enumeration_cap() {
    let mut bus = FakeBus::default();
    bus.add(1, 0, FakeNode::new(Role::Application, "many"));
    for id in 100..160 {
        bus.add(id, 1, FakeNode::frame("w", EDITOR_RECT));
    }
    assert_eq!(AtSpiAx::with_bus(bus).windows().unwrap().len(), 48);
}

#[test]
fn window_root_prefers_the_pid_owner_over_a_same_named_app() {
    // Given two "gedit" applications; only the second owns pid 7
    let mut bus = editor();
    bus.add(2, 0, FakeNode::new(Role::Application, "gedit"));
    bus.pids.insert(2, 7);
    bus.add(20, 2, FakeNode::frame("notes.txt - gedit", EDITOR_RECT));
    // When the root of pid 7's window is resolved
    let mut ax = AtSpiAx::with_bus(bus);
    // Then it is the pid owner's frame
    assert_eq!(
        root_id(&mut ax, &window("gedit", "notes.txt - gedit", Some(7))),
        20
    );
}

#[test]
fn window_root_picks_the_nearest_bounds_among_same_titled_frames() {
    let mut bus = editor();
    bus.add(
        14,
        1,
        FakeNode::frame(
            "notes.txt - gedit",
            Extents {
                x: 900,
                ..EDITOR_RECT
            },
        ),
    );
    let mut ax = AtSpiAx::with_bus(bus);
    let mut far = window("gedit", "notes.txt - gedit", Some(4242));
    far.x = 900;
    assert_eq!(root_id(&mut ax, &far), 14);
    assert_eq!(
        root_id(&mut ax, &window("gedit", "notes.txt - gedit", Some(4242))),
        10
    );
}

#[test]
fn window_root_prefers_a_title_match_over_nearer_bounds() {
    let mut bus = editor();
    bus.add(14, 1, FakeNode::frame("Preferences", EDITOR_RECT));
    let mut ax = AtSpiAx::with_bus(bus);
    assert_eq!(root_id(&mut ax, &window("gedit", "Preferences", None)), 14);
}

#[test]
fn window_root_without_an_owning_application_is_ax_failed() {
    let mut ax = AtSpiAx::with_bus(editor());
    let error = ax
        .window_root(&window("firefox", "Mozilla", Some(1)))
        .err()
        .unwrap();
    assert_eq!(error.code, ErrorCode::AxFailed);
}

#[test]
fn props_normalize_the_role_and_read_each_interface() {
    let mut ax = AtSpiAx::with_bus(editor());
    let entry = ax.props(&node(12)).unwrap();
    assert_eq!(
        (entry.role.as_str(), entry.native_role.as_str()),
        ("textarea", "entry")
    );
    assert_eq!(entry.value.as_deref(), Some("hello"));
    assert!(entry.enabled && entry.focused);
    assert_eq!(
        entry.bounds,
        Some(AxBounds {
            x: 30.0,
            y: 40.0,
            width: 200.0,
            height: 24.0
        })
    );
    let button = ax.props(&node(11)).unwrap();
    assert_eq!(button.role, "button");
    assert_eq!(button.actions, ["click", "press", "release"]);
}

#[test]
fn props_skip_interfaces_the_element_does_not_implement() {
    // Given a label that carries text but does not implement Text
    let mut bus = editor();
    let mut label = FakeNode::new(Role::Label, "Name");
    label.text = "unreachable".into();
    bus.add(15, 10, label);
    // When its props are read
    let props = AtSpiAx::with_bus(bus).props(&node(15)).unwrap();
    // Then the text is not read and there are no bounds
    assert_eq!((props.value, props.bounds), (None, None));
}

#[test]
fn props_fall_back_to_the_localized_role_name() {
    let mut bus = editor();
    let mut odd = FakeNode::new(Role::Panel, "");
    odd.role_name = None;
    odd.localized_role_name = Some("tool bar".into());
    bus.add(16, 10, odd);
    let props = AtSpiAx::with_bus(bus).props(&node(16)).unwrap();
    assert_eq!((props.role.as_str(), props.title), ("toolbar", None));
}

#[test]
fn props_of_a_vanished_element_are_ax_failed() {
    let error = AtSpiAx::with_bus(editor()).props(&node(99)).unwrap_err();
    assert_eq!(error.code, ErrorCode::AxFailed);
}

#[test]
fn a_foreign_handle_is_ax_failed() {
    let error = AtSpiAx::with_bus(editor()).props(&AxHandle::Id(11)).unwrap_err();
    assert_eq!(error.code, ErrorCode::AxFailed);
}

#[test]
fn element_at_asks_the_frame_containing_the_rounded_point() {
    let mut bus = editor();
    bus.nodes.get_mut(&10).unwrap().hit = Some(12);
    let mut ax = AtSpiAx::with_bus(bus);
    let found = ax.element_at(40.6, 50.4).unwrap().unwrap();
    assert_eq!(found.downcast_native::<u64>(), Some(&12));
    assert_eq!(ax.bus.calls, ["hit 10 @41,50"]);
    assert!(ax.element_at(5000.0, 5000.0).unwrap().is_none());
}

#[test]
fn focused_element_is_found_depth_first() {
    let mut ax = AtSpiAx::with_bus(editor());
    let found = ax.focused_element().unwrap().unwrap();
    assert_eq!(found.downcast_native::<u64>(), Some(&12));
}

#[test]
fn attributes_are_sorted_and_cut_on_char_boundaries() {
    let mut bus = editor();
    let long = "é".repeat(300);
    bus.nodes.get_mut(&11).unwrap().attributes = vec![("toolkit".into(), "gtk".into()), ("id".into(), long)];
    let attributes = AtSpiAx::with_bus(bus).attributes(&node(11)).unwrap();
    assert_eq!(attributes[0].0, "id");
    assert_eq!(attributes[0].1.chars().count(), 200);
    assert_eq!(attributes[1], ("toolkit".into(), "gtk".into()));
}

#[test]
fn children_drop_null_refs_and_the_top_has_no_parent() {
    let mut bus = editor();
    bus.nodes.get_mut(&10).unwrap().children.push(0);
    let mut ax = AtSpiAx::with_bus(bus);
    assert_eq!(ax.children(&node(10)).unwrap().len(), 2);
    assert!(ax.parent(&node(1)).unwrap().is_none());
    let parent = ax.parent(&node(11)).unwrap().unwrap();
    assert_eq!(parent.downcast_native::<u64>(), Some(&10));
}

#[test]
fn snapshot_renders_the_frame_as_ref_e1_window() {
    let mut ax = AtSpiAx::with_bus(editor());
    let win = window("gedit", "notes.txt - gedit", Some(4242));
    let mut registry = AxRegistry::default();
    let tree = snapshot(&mut ax, &mut registry, &win, &AxSnapshotOptions::default()).unwrap();
    let first = tree.text.lines().next().unwrap();
    assert!(
        first.starts_with("- window \"notes.txt - gedit\" [ref=e1]"),
        "{first}"
    );
}

#[test]
fn permission_follows_the_registry() {
    let mut silent = FakeBus::default();
    assert_eq!(
        AtSpiAx::with_bus(silent).permission(),
        AxPermission::ToolkitsSilent
    );
    silent = FakeBus {
        registry_down: true,
        ..FakeBus::default()
    };
    assert_eq!(
        AtSpiAx::with_bus(silent).permission(),
        AxPermission::BusUnreachable
    );
    let mut ax = AtSpiAx::with_bus(editor());
    assert_eq!(AxPermission::of(Some(&mut ax)), AxPermission::Granted);
    assert_eq!(AxPermission::of::<FakeBus>(None), AxPermission::BusUnreachable);
}

#[test]
fn permission_labels_are_the_capability_values() {
    let labels = [
        AxPermission::BusUnreachable,
        AxPermission::ToolkitsSilent,
        AxPermission::Granted,
    ]
    .map(|permission| (permission.as_str(), permission.is_granted()));
    assert_eq!(
        labels,
        [
            ("bus-unreachable", false),
            ("toolkits-silent", false),
            ("granted", true)
        ]
    );
}
