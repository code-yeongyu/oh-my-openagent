//! `correlate_owner` over plain window lists: which X11 window an element's
//! frame provably is, and every case that must stay unknown.

use senpi_desktop_core::types::DesktopWindow;

use crate::bus::Extents;
use crate::owner::{correlate_owner, FrameFacts};

const PID: u32 = 4242;

fn win(id: &str, title: &str, pid: Option<u32>, rect: (i32, i32, u32, u32)) -> DesktopWindow {
    DesktopWindow {
        id: id.to_string(),
        title: title.to_string(),
        app: "gedit".to_string(),
        pid,
        x: rect.0,
        y: rect.1,
        width: rect.2,
        height: rect.3,
        focused: false,
        elevated: None,
    }
}

fn frame(title: &str, extents: Option<(i32, i32, i32, i32)>) -> FrameFacts {
    FrameFacts {
        pid: Some(PID),
        title: title.to_string(),
        extents: extents.map(|(x, y, width, height)| Extents { x, y, width, height }),
        sole_frame: false,
    }
}

fn owner(frame: &FrameFacts, windows: &[DesktopWindow]) -> Option<String> {
    correlate_owner(frame, windows)
}

#[test]
fn picks_the_same_pid_window_whose_title_and_geometry_match_the_frame() {
    // Given: A and B of one process, B's frame named and placed like B.
    let windows = [
        win("0xa", "a.txt - gedit", Some(PID), (100, 100, 640, 480)),
        win("0xb", "b.txt - gedit", Some(PID), (400, 300, 640, 480)),
    ];
    // When / Then
    assert_eq!(
        owner(&frame("b.txt - gedit", Some((400, 300, 640, 480))), &windows),
        Some("0xb".into())
    );
}

#[test]
fn ignores_another_process_window_at_the_frame_geometry() {
    // Given: a foreign window sits exactly on B, and is listed first.
    let windows = [
        win("0xf", "b.txt - gedit", Some(8), (400, 300, 640, 480)),
        win("0xb", "b.txt - gedit", Some(PID), (400, 300, 640, 480)),
    ];
    // When / Then: pid linkage excludes it.
    assert_eq!(
        owner(&frame("b.txt - gedit", Some((400, 300, 640, 480))), &windows),
        Some("0xb".into())
    );
}

#[test]
fn geometry_separates_same_title_windows_and_tolerates_decorations() {
    // Given: two same-title windows; the frame is B's client area inside
    // a titlebar and borders (5 + 28 + 10 + 33 = 76 px off).
    let windows = [
        win("0xa", "Untitled", Some(PID), (100, 100, 640, 480)),
        win("0xb", "Untitled", Some(PID), (700, 300, 650, 513)),
    ];
    // When / Then
    assert_eq!(
        owner(&frame("Untitled", Some((705, 328, 640, 480))), &windows),
        Some("0xb".into())
    );
}

#[test]
fn refuses_same_title_windows_that_geometry_cannot_tell_apart() {
    // Given: two same-title windows 10 px apart, under the 24 px margin.
    let windows = [
        win("0xa", "Untitled", Some(PID), (400, 300, 640, 480)),
        win("0xb", "Untitled", Some(PID), (410, 300, 640, 480)),
    ];
    // When / Then
    assert_eq!(owner(&frame("Untitled", Some((405, 300, 640, 480))), &windows), None);
}

#[test]
fn refuses_same_title_windows_at_identical_geometry() {
    let windows = [
        win("0xa", "Untitled", Some(PID), (400, 300, 640, 480)),
        win("0xb", "Untitled", Some(PID), (400, 300, 640, 480)),
    ];
    assert_eq!(owner(&frame("Untitled", Some((400, 300, 640, 480))), &windows), None);
}

#[test]
fn a_unique_title_separates_windows_that_geometry_cannot() {
    // Given: stacked same-geometry windows with different titles.
    let windows = [
        win("0xa", "a.txt - gedit", Some(PID), (400, 300, 640, 480)),
        win("0xb", "b.txt - gedit", Some(PID), (400, 300, 640, 480)),
    ];
    // When / Then
    assert_eq!(
        owner(&frame("b.txt - gedit", Some((400, 300, 640, 480))), &windows),
        Some("0xb".into())
    );
}

#[test]
fn refuses_when_title_and_geometry_disagree() {
    // Given: the frame sits on A but carries B's exact title.
    let windows = [
        win("0xa", "a.txt - gedit", Some(PID), (100, 100, 640, 480)),
        win("0xb", "b.txt - gedit", Some(PID), (700, 300, 640, 480)),
    ];
    // When / Then
    assert_eq!(owner(&frame("b.txt - gedit", Some((100, 100, 640, 480))), &windows), None);
}

#[test]
fn refuses_when_no_same_pid_window_is_close_enough() {
    // Given: the one same-pid window is far from the frame.
    let windows = [win("0xa", "a.txt - gedit", Some(PID), (900, 700, 300, 200))];
    // When / Then: even its exact title cannot outvote the geometry.
    assert_eq!(owner(&frame("a.txt - gedit", Some((100, 100, 640, 480))), &windows), None);
}

#[test]
fn origin_collapsed_extents_fall_back_to_a_unique_title() {
    // Given: GTK4 on X11 reports frames at (0,0).
    let windows = [
        win("0xa", "a.txt - gedit", Some(PID), (100, 100, 640, 480)),
        win("0xb", "b.txt - gedit", Some(PID), (700, 300, 640, 480)),
    ];
    // When / Then
    assert_eq!(
        owner(&frame("b.txt - gedit", Some((0, 0, 640, 480))), &windows),
        Some("0xb".into())
    );
}

#[test]
fn origin_collapsed_extents_with_duplicate_titles_are_unknown() {
    let windows = [
        win("0xa", "Untitled", Some(PID), (100, 100, 640, 480)),
        win("0xb", "Untitled", Some(PID), (700, 300, 640, 480)),
    ];
    assert_eq!(owner(&frame("Untitled", Some((0, 0, 640, 480))), &windows), None);
}

#[test]
fn an_unknown_or_unlisted_pid_is_unknown() {
    // Given: the window list names the frame's window, but not by pid.
    let windows = [win("0xa", "a.txt - gedit", None, (100, 100, 640, 480))];
    let placed = frame("a.txt - gedit", Some((100, 100, 640, 480)));
    // When / Then: no pid on the window, then no pid on the frame.
    assert_eq!(owner(&placed, &windows), None);
    let pidless = FrameFacts { pid: None, ..placed };
    let listed = [win("0xa", "a.txt - gedit", Some(PID), (100, 100, 640, 480))];
    assert_eq!(owner(&pidless, &listed), None);
}

#[test]
fn a_sole_frame_without_usable_extents_or_title_is_the_pids_only_window() {
    // Given: an untitled frame without extents, alone in its application.
    let windows = [
        win("0xf", "", Some(8), (100, 100, 640, 480)),
        win("0xa", "Editor", Some(PID), (100, 100, 640, 480)),
    ];
    let sole = FrameFacts {
        sole_frame: true,
        ..frame("", None)
    };
    // When / Then
    assert_eq!(owner(&sole, &windows), Some("0xa".into()));
    // And: a second frame in the application makes that unprovable.
    assert_eq!(owner(&FrameFacts { sole_frame: false, ..sole }, &windows), None);
}
