//! Element ownership over the in-memory bus: a frame is its own window
//! when the host lists AT-SPI frames, else the native window it provably is.

use atspi::Role;
use senpi_desktop_core::ax::{AxBackend, AxOwner};
use senpi_desktop_core::types::DesktopWindow;

use crate::bus::Extents;
use crate::fake::{editor, node, FakeBus, FakeNode, EDITOR_RECT};
use crate::{AtSpiAx, WindowIds};

fn frames_backend(bus: FakeBus) -> AtSpiAx<FakeBus> {
    AtSpiAx {
        bus,
        window_ids: WindowIds::AtSpiFrames,
    }
}

#[test]
fn owner_is_the_listed_frame_when_windows_are_frames() {
    // Given: the editor's focused entry sits in frame 10.
    let mut ax = frames_backend(editor());
    let listed = ax.windows().unwrap().remove(0).id;
    // When
    let owner = ax.owner(&node(12), &[]).unwrap();
    // Then: the owner is the id `windows()` lists for that frame.
    assert_eq!(owner, AxOwner::Window(listed));
}

/// The editor plus a second frame of the same process, "todo.txt - gedit"
/// (id 30, holding button 31), placed away from the first.
fn two_frame_editor(todo_title: &str, todo_rect: Extents) -> FakeBus {
    let mut bus = editor();
    bus.add(30, 1, FakeNode::frame(todo_title, todo_rect));
    bus.add(31, 30, FakeNode::new(Role::Button, "Done"));
    bus
}

const TODO_RECT: Extents = Extents {
    x: 300,
    y: 200,
    width: 640,
    height: 480,
};

fn xid(id: &str, title: &str, pid: u32, rect: Extents) -> DesktopWindow {
    DesktopWindow {
        id: id.to_string(),
        title: title.to_string(),
        app: "gedit".to_string(),
        pid: Some(pid),
        x: rect.x,
        y: rect.y,
        width: rect.width.unsigned_abs(),
        height: rect.height.unsigned_abs(),
        focused: false,
        elevated: None,
    }
}

#[test]
fn owner_on_x11_is_the_window_each_frame_provably_is() {
    // Given: X11 lists a foreign window over the todo window first, then
    // both windows of the editor's process.
    let mut ax = AtSpiAx::with_bus(two_frame_editor("todo.txt - gedit", TODO_RECT));
    let windows = [
        xid("9", "todo.txt - gedit", 8, TODO_RECT),
        xid("3", "todo.txt - gedit", 4242, TODO_RECT),
        xid("1", "notes.txt - gedit", 4242, EDITOR_RECT),
    ];
    // When / Then: each element names its own frame's window.
    assert_eq!(ax.owner(&node(31), &windows).unwrap(), AxOwner::Window("3".into()));
    assert_eq!(ax.owner(&node(12), &windows).unwrap(), AxOwner::Window("1".into()));
}

#[test]
fn owner_on_x11_is_unknown_when_same_pid_windows_are_indistinguishable() {
    // Given: two frames and two windows of one process, same title and place.
    let mut ax = AtSpiAx::with_bus(two_frame_editor("notes.txt - gedit", EDITOR_RECT));
    let windows = [
        xid("3", "notes.txt - gedit", 4242, EDITOR_RECT),
        xid("1", "notes.txt - gedit", 4242, EDITOR_RECT),
    ];
    // When / Then
    assert_eq!(ax.owner(&node(31), &windows).unwrap(), AxOwner::Unknown);
}

#[test]
fn owner_on_x11_is_unknown_without_the_applications_pid() {
    // Given: the bus does not report the editor's pid.
    let mut bus = editor();
    bus.pids.clear();
    let mut ax = AtSpiAx::with_bus(bus);
    let windows = [xid("1", "notes.txt - gedit", 4242, EDITOR_RECT)];
    // When / Then
    assert_eq!(ax.owner(&node(12), &windows).unwrap(), AxOwner::Unknown);
}

#[test]
fn owner_is_unknown_outside_any_frame() {
    // Given: a panel directly under the application, not a frame.
    let mut bus = editor();
    bus.add(20, 1, FakeNode::new(Role::Panel, "tray"));
    bus.add(21, 20, FakeNode::new(Role::Button, "tray button"));
    let mut ax = frames_backend(bus);
    // When / Then
    assert_eq!(ax.owner(&node(21), &[]).unwrap(), AxOwner::Unknown);
}
