//! Admission and lifecycle properties that must hold before libei sends an
//! event. The fake EIS server is the protocol peer, not an implementation
//! mock.

use senpi_desktop_core::backend::{Backend, DeliveryMode, Modifiers, MouseButton, PointerEvent};
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::types::Target;

use super::eis_tests::{session, session_with_topology};
use super::tests::FR;
use crate::test_support::env_lock;
use crate::test_support::fake_eis::{DeviceTopology, EisConfig, Recorded};

fn pointer(backend: &mut impl Backend, event: PointerEvent) -> Result<(), ErrorCode> {
    backend
        .pointer(
            &Target::Desktop,
            event,
            &FrameGeometry::for_displays(&[]),
            DeliveryMode::Background,
        )
        .map_err(|error| error.code)
}

fn modified_click() -> PointerEvent {
    PointerEvent::Click {
        x: 100.0,
        y: 200.0,
        button: MouseButton::Left,
        count: 1,
        modifiers: Modifiers {
            ctrl: true,
            ..Modifiers::default()
        },
    }
}

#[test]
fn modified_click_without_keyboard_refuses_before_pointer_input() {
    let _env = env_lock();
    let mut session = session_with_topology(
        EisConfig {
            keymap: FR,
            group: 0,
        },
        DeviceTopology::PointerOnly,
    );

    let result = pointer(&mut session.backend, modified_click());

    assert_eq!(result, Err(ErrorCode::PermissionDenied));
    let log = session.eis.wait_for(|log| log.connected);
    assert!(log.events.is_empty(), "{:?}", log.events);
}

#[test]
fn modified_click_with_keyboard_on_another_seat_refuses_before_input() {
    let _env = env_lock();
    let mut session = session_with_topology(
        EisConfig {
            keymap: FR,
            group: 0,
        },
        DeviceTopology::SplitSeats,
    );

    let result = pointer(&mut session.backend, modified_click());

    assert_eq!(result, Err(ErrorCode::PermissionDenied));
    let log = session.eis.wait_for(|log| log.connected);
    assert!(log.events.is_empty(), "{:?}", log.events);
}

#[test]
fn paused_pointer_is_refused_on_the_next_operation() {
    let _env = env_lock();
    let mut session = session(EisConfig {
        keymap: FR,
        group: 0,
    });
    assert_eq!(
        pointer(
            &mut session.backend,
            PointerEvent::Move { x: 10.0, y: 20.0 }
        ),
        Ok(())
    );
    session.eis.wait_for(|log| !log.events.is_empty());
    session.eis.pause_pointer();

    let result = pointer(
        &mut session.backend,
        PointerEvent::Move { x: 30.0, y: 40.0 },
    );

    assert_eq!(result, Err(ErrorCode::InputFailed));
    let log = session.eis.wait_for(|log| !log.events.is_empty());
    assert_eq!(log.events, [Recorded::Motion { x: 10.0, y: 20.0 }]);
}

#[test]
fn removed_pointer_is_refused_on_the_next_operation() {
    let _env = env_lock();
    let mut session = session(EisConfig {
        keymap: FR,
        group: 0,
    });
    assert_eq!(
        pointer(
            &mut session.backend,
            PointerEvent::Move { x: 10.0, y: 20.0 }
        ),
        Ok(())
    );
    session.eis.wait_for(|log| !log.events.is_empty());
    session.eis.remove_pointer();

    let result = pointer(
        &mut session.backend,
        PointerEvent::Move { x: 30.0, y: 40.0 },
    );

    assert_eq!(result, Err(ErrorCode::InputFailed));
    let log = session.eis.wait_for(|log| !log.events.is_empty());
    assert_eq!(log.events, [Recorded::Motion { x: 10.0, y: 20.0 }]);
}

#[test]
fn scroll_delta_is_emitted_as_discrete_wheel_units() {
    let _env = env_lock();
    let mut session = session(EisConfig {
        keymap: FR,
        group: 0,
    });

    let result = pointer(
        &mut session.backend,
        PointerEvent::Scroll {
            x: 50.0,
            y: 60.0,
            dx: 40.0,
            dy: -80.0,
        },
    );

    assert_eq!(result, Ok(()));
    let log = session.eis.wait_for(|log| !log.discrete_scroll.is_empty());
    assert_eq!(log.events, [Recorded::Motion { x: 50.0, y: 60.0 }]);
    assert!(log.continuous_scroll.is_empty());
    assert_eq!(log.discrete_scroll, [(120, -240)]);
}
