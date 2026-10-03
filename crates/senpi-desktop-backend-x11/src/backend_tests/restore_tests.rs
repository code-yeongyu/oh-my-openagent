use senpi_desktop_core::backend::{Backend, DeliveryMode, Modifiers, MouseButton, PointerEvent};
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::types::{DesktopPoint, Target};

use super::{backend, FakeInputServer, EDITOR};

#[test]
fn failed_click_restores_the_motion_that_preceded_failure() {
    let input = FakeInputServer::new(Some(EDITOR));
    input.pointer.set((12, 34));
    input.fail_at.set(Some(1));
    let mut backend = backend(Ok(input));

    let error = backend
        .pointer(
            &Target::Desktop,
            PointerEvent::Click {
                x: 510.0,
                y: 10.0,
                button: MouseButton::Left,
                count: 1,
                modifiers: Modifiers::default(),
            },
            &FrameGeometry::identity_global(),
            DeliveryMode::Foreground,
        )
        .unwrap_err();
    assert_eq!(error.code, ErrorCode::InputFailed);
    assert_eq!(backend.input_ref().unwrap().server().pointer.get(), (510, 10));

    backend.warp_cursor(DesktopPoint { x: 12.0, y: 34.0 }).unwrap();

    assert_eq!(backend.input_ref().unwrap().server().pointer.get(), (12, 34));
}

#[test]
fn user_motion_before_action_returns_is_not_claimed_by_the_engine() {
    let input = FakeInputServer::new(Some(EDITOR));
    input.pointer.set((12, 34));
    input.pointer_after_flush.set(Some((900, 700)));
    let mut backend = backend(Ok(input));

    backend
        .pointer(
            &Target::Desktop,
            PointerEvent::Move { x: 510.0, y: 10.0 },
            &FrameGeometry::identity_global(),
            DeliveryMode::Foreground,
        )
        .unwrap();
    assert_eq!(backend.input_ref().unwrap().server().pointer.get(), (900, 700));

    backend.warp_cursor(DesktopPoint { x: 12.0, y: 34.0 }).unwrap();

    assert_eq!(backend.input_ref().unwrap().server().pointer.get(), (900, 700));
}
