//! the virtual pointer client: the wire handshake and every request
//! encoding, verified against a fake compositor that decodes independently.

use std::time::Duration;

use super::test_support::{FakeWayland, WireRequest};
use crate::pointer::{wayland_socket_path, VirtualPointer, BTN_LEFT};

const WAIT: Duration = Duration::from_secs(2);

#[test]
fn the_handshake_binds_the_manager_and_seat_and_creates_one_pointer() {
    let fake = FakeWayland::start();
    let pointer = VirtualPointer::connect(Some(&fake.path)).expect("connect");

    let requests = fake.wait_for(WAIT, |requests| {
        requests
            .iter()
            .any(|request| matches!(request, WireRequest::CreatePointer { .. }))
    });

    let bind = |interface: &str| {
        requests.iter().find_map(|request| match request {
            WireRequest::Bind {
                name,
                interface: bound,
                version,
                id,
            } if bound == interface => Some((*name, *version, *id)),
            _ => None,
        })
    };
    assert_eq!(
        bind("zwlr_virtual_pointer_manager_v1"),
        Some((42, 1, 3)),
        "the client binds the manager global by name at version 1"
    );
    assert_eq!(
        bind("wl_seat"),
        Some((43, 1, 4)),
        "a seat is bound, because sway refuses a null seat"
    );
    let created = requests.iter().find_map(|request| match request {
        WireRequest::CreatePointer { seat, id } => Some((*seat, *id)),
        _ => None,
    });
    assert_eq!(created, Some((4, 6)));
    drop(pointer);
}

#[test]
fn motion_absolute_is_encoded_with_the_extent() {
    let fake = FakeWayland::start();
    let mut pointer = VirtualPointer::connect(Some(&fake.path)).expect("connect");

    pointer
        .motion_absolute(960, 600, 1920, 1200)
        .expect("motion");

    let requests = fake.wait_for(WAIT, |requests| {
        requests
            .iter()
            .any(|request| matches!(request, WireRequest::MotionAbsolute { .. }))
    });
    assert!(requests.contains(&WireRequest::MotionAbsolute {
        x: 960,
        y: 600,
        x_extent: 1920,
        y_extent: 1200
    }));
}

#[test]
fn a_button_press_and_release_each_frame() {
    let fake = FakeWayland::start();
    let mut pointer = VirtualPointer::connect(Some(&fake.path)).expect("connect");

    pointer.button(BTN_LEFT, true).expect("press");
    pointer.button(BTN_LEFT, false).expect("release");

    let requests = fake.wait_for(WAIT, |requests| {
        requests
            .iter()
            .filter(|request| matches!(request, WireRequest::Frame))
            .count()
            >= 2
    });
    assert!(requests.contains(&WireRequest::Button {
        code: BTN_LEFT,
        state: 1
    }));
    assert!(requests.contains(&WireRequest::Button {
        code: BTN_LEFT,
        state: 0
    }));
    assert_eq!(
        requests
            .iter()
            .filter(|request| matches!(request, WireRequest::Frame))
            .count(),
        2,
        "each button event ends with a frame"
    );
}

#[test]
fn release_all_lifts_what_was_pressed() {
    let fake = FakeWayland::start();
    let mut pointer = VirtualPointer::connect(Some(&fake.path)).expect("connect");

    pointer.button(BTN_LEFT, true).expect("press");
    pointer.release_all().expect("release all");

    let requests = fake.wait_for(WAIT, |requests| {
        requests
            .iter()
            .filter(|request| matches!(request, WireRequest::Button { state: 0, .. }))
            .count()
            >= 1
    });
    assert!(requests.contains(&WireRequest::Button {
        code: BTN_LEFT,
        state: 0
    }));

    pointer.release_all().expect("release all is idempotent");
}

#[test]
fn a_scroll_sends_both_axes_as_fixed_point() {
    let fake = FakeWayland::start();
    let mut pointer = VirtualPointer::connect(Some(&fake.path)).expect("connect");

    pointer.scroll(2.0, -3.0).expect("scroll");

    let requests = fake.wait_for(WAIT, |requests| {
        requests
            .iter()
            .filter(|request| matches!(request, WireRequest::Axis { .. }))
            .count()
            >= 2
    });
    assert!(requests.contains(&WireRequest::Axis {
        axis: 0,
        value: -3.0
    }));
    assert!(requests.contains(&WireRequest::Axis {
        axis: 1,
        value: 2.0
    }));
}

#[test]
fn motion_absolute_ends_with_a_frame() {
    // wl_pointer events commit on frame; an unframed motion would sit
    // unprocessed on the compositor's seat.
    let fake = FakeWayland::start();
    let mut pointer = VirtualPointer::connect(Some(&fake.path)).expect("connect");

    pointer
        .motion_absolute(960, 600, 1920, 1200)
        .expect("motion");

    let requests = fake.wait_for(WAIT, |requests| {
        requests
            .iter()
            .filter(|request| matches!(request, WireRequest::Frame))
            .count()
            >= 1
    });
    let motion_at = requests
        .iter()
        .position(|request| matches!(request, WireRequest::MotionAbsolute { .. }))
        .expect("the motion was sent");
    let frame_at = requests
        .iter()
        .position(|request| matches!(request, WireRequest::Frame))
        .expect("the motion was framed");
    assert!(frame_at > motion_at, "the frame follows the motion");
}

#[test]
fn a_compositor_without_the_manager_refuses_input() {
    let fake = FakeWayland::start_without_manager();

    let error = VirtualPointer::connect(Some(&fake.path))
        .err()
        .expect("no manager negotiation");

    assert!(error.message.contains("does not advertise"));
}

#[test]
fn a_missing_socket_fails_to_connect() {
    let dir = tempfile::tempdir().expect("tempdir");
    let gone = dir.path().join("gone.sock");
    let error = VirtualPointer::connect(Some(&gone))
        .err()
        .expect("no compositor");

    assert!(error.message.contains("wayland socket"));
}

#[test]
fn the_socket_path_prefers_absolute_display_names() {
    let env = |name: &str| match name {
        "WAYLAND_DISPLAY" => Some(std::ffi::OsString::from("/run/user/1000/wayland-1")),
        _ => None,
    };
    assert_eq!(
        wayland_socket_path(&env).expect("path"),
        std::path::PathBuf::from("/run/user/1000/wayland-1")
    );

    let env = |name: &str| match name {
        "WAYLAND_DISPLAY" => Some(std::ffi::OsString::from("wayland-1")),
        "XDG_RUNTIME_DIR" => Some(std::ffi::OsString::from("/run/user/1000")),
        _ => None,
    };
    assert_eq!(
        wayland_socket_path(&env).expect("path"),
        std::path::PathBuf::from("/run/user/1000/wayland-1")
    );

    let env = |name: &str| match name {
        "WAYLAND_DISPLAY" => Some(std::ffi::OsString::from("wayland-1")),
        _ => None,
    };
    assert!(wayland_socket_path(&env).is_err());
}
