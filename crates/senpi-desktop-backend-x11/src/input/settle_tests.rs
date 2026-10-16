//! Foreground XTEST delivery against a window manager that holds presses
//! under a synchronous grab (omo #9136): no button before the target is under
//! the pointer, no focus restore before every press was replayed.

use senpi_desktop_core::backend::{DeliveryMode, PointerEvent};
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::types::Target;
use x11rb::protocol::xproto::Window;

use super::fake::Call;
use super::server::FakeInput;
use super::tests::input;
use super::X11Input;

const TERMINAL: Window = 0x40_0001;
const EDITOR: Window = 0x80_0001;

const SCROLL_DOWN: PointerEvent = PointerEvent::Scroll {
    x: 150.0,
    y: 80.0,
    dx: 0.0,
    dy: 120.0,
};

fn scroll_terminal(input: &mut X11Input<super::fake::FakeInputServer>) -> senpi_desktop_core::error::CoreResult<()> {
    input.pointer(&Target::Window(TERMINAL.to_string()), &SCROLL_DOWN, DeliveryMode::Foreground)
}

const fn wheel(press: bool) -> Call {
    Call::Fake(FakeInput::Button { detail: 5, press })
}

#[test]
fn each_wheel_click_waits_for_the_window_manager_to_release_the_pointer_before_the_next() {
    // Given: the window manager holds the pointer for two probes after the first click
    let mut input = input();
    input.server.held_probes.set(2);

    // When
    scroll_terminal(&mut input).unwrap();

    // Then: no press while the previous one is held, and the restore comes last
    assert_eq!(
        input.server.calls(),
        [
            Call::Activate(TERMINAL),
            Call::Fake(FakeInput::Motion { x: 150, y: 80 }),
            wheel(true),
            wheel(false),
            Call::HeldProbe,
            Call::HeldProbe,
            Call::HeldProbe,
            wheel(true),
            wheel(false),
            Call::HeldProbe,
            wheel(true),
            wheel(false),
            Call::HeldProbe,
            Call::HeldProbe,
            Call::Activate(EDITOR),
        ]
    );
}

#[test]
fn a_pointer_that_stays_held_fails_the_scroll_as_unconfirmed_and_still_restores_focus() {
    // Given: the pointer is never released
    let mut input = input();
    input.server.held_probes.set(usize::MAX);

    // When
    let error = scroll_terminal(&mut input).unwrap_err();

    // Then: no success is reported, and the previous window is active again
    assert_eq!(error.code, ErrorCode::InputFailed);
    assert!(error.message.contains("delivery is unconfirmed"), "{}", error.message);
    assert_eq!(input.server.calls().last(), Some(&Call::Activate(EDITOR)));
}

#[test]
fn a_point_another_window_keeps_covering_gets_no_button() {
    // Given: another window covers the scroll point for good
    let mut input = input();
    input.server.covered_probes.set(usize::MAX);

    // When
    let error = scroll_terminal(&mut input).unwrap_err();

    // Then: no wheel click was sent to the covering window
    assert_eq!(error.code, ErrorCode::InputFailed);
    assert!(error.message.contains("is not over window"), "{}", error.message);
    let calls = input.server.calls();
    assert!(!calls.iter().any(|call| matches!(call, Call::Fake(FakeInput::Button { .. }))), "{calls:?}");
    assert_eq!(calls.last(), Some(&Call::Activate(EDITOR)));
}

#[test]
fn a_target_raised_over_the_point_after_a_restack_gets_every_click() {
    // Given: the window manager restacks the target over the point after two probes
    let mut input = input();
    input.server.covered_probes.set(2);

    // When
    scroll_terminal(&mut input).unwrap();

    // Then
    let presses = input
        .server
        .calls()
        .into_iter()
        .filter(|call| *call == wheel(true))
        .count();
    assert_eq!(presses, 3);
}
