//! Delivery routing and the focus guard against the
//! recording `FakeInputServer`.

use senpi_desktop_core::backend::{DeliveryMode, Modifiers, MouseButton, PointerEvent};
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::keys::KeyName;
use senpi_desktop_core::types::Target;
use x11rb::protocol::xproto::Window;

use super::fake::{Call, FakeInputServer, KEY_A, KEY_C, KEY_CONTROL_L, KEY_SHIFT_L};
use super::server::{FakeInput, SentEvent, Spot};
use super::X11Input;

const TERMINAL: Window = 0x40_0001;
const GTK_APP: Window = 0x60_0001;
const EDITOR: Window = 0x80_0001;

pub(super) fn input() -> X11Input<FakeInputServer> {
    X11Input::with_server(
        FakeInputServer::new(Some(EDITOR))
            .window(TERMINAL, (100, 50), b"xterm\0XTerm\0")
            .window(GTK_APP, (0, 0), b"gtk3-demo\0Gtk3-demo\0"),
    )
}

fn click(x: f64, y: f64) -> PointerEvent {
    PointerEvent::Click {
        x,
        y,
        button: MouseButton::Left,
        count: 1,
        modifiers: Modifiers::default(),
    }
}

pub(super) const fn fake_key(code: u8, press: bool) -> Call {
    Call::Fake(FakeInput::Key { code, press })
}

pub(super) const fn fake_button(press: bool) -> Call {
    Call::Fake(FakeInput::Button { detail: 1, press })
}

fn window(id: Window) -> Target {
    Target::Window(id.to_string())
}

#[test]
fn a_desktop_click_is_xtest_motion_then_press_then_release() {
    let mut input = input();

    input
        .pointer(&Target::Desktop, &click(10.4, 20.6), DeliveryMode::Background)
        .unwrap();

    assert_eq!(
        input.server.calls(),
        [
            Call::Fake(FakeInput::Motion { x: 10, y: 21 }),
            fake_button(true),
            fake_button(false),
        ]
    );
}

#[test]
fn a_background_click_is_sent_to_the_window_at_its_local_point_without_moving_focus() {
    let mut input = input();

    input
        .pointer(&window(TERMINAL), &click(130.0, 70.0), DeliveryMode::Background)
        .unwrap();

    let at = Spot {
        root: (130, 70),
        local: (30, 20),
    };
    let button1 = 1 << 8;
    assert_eq!(
        input.server.calls(),
        [
            Call::Send(
                TERMINAL,
                SentEvent::Button {
                    detail: 1,
                    press: true,
                    at,
                    state: 0
                }
            ),
            Call::Send(
                TERMINAL,
                SentEvent::Button {
                    detail: 1,
                    press: false,
                    at,
                    state: button1
                }
            ),
        ]
    );
    assert_eq!(input.active_window(), Some(EDITOR));
}

#[test]
fn background_input_to_a_filtering_toolkit_is_refused_naming_it_and_sends_nothing() {
    let target = window(GTK_APP);
    let refusals = {
        let mut input = input();
        [
            input.pointer(&target, &click(5.0, 5.0), DeliveryMode::Background),
            input.type_text(&target, "a", DeliveryMode::Background),
            input.key_chord(
                &target,
                &[KeyName::Ctrl, KeyName::Char('c')],
                DeliveryMode::Background,
            ),
        ]
        .map(|result| (result.unwrap_err(), input.server.calls().len()))
    };

    for (error, calls) in refusals {
        assert_eq!(error.code, ErrorCode::BackgroundUnavailable);
        assert!(error.message.contains("GTK"), "{}", error.message);
        assert_eq!(calls, 0, "no input may be delivered");
    }
}

#[test]
fn foreground_delivery_activates_the_target_then_restores_the_previous_window() {
    let mut input = input();
    let before = input.active_window();

    input
        .pointer(&window(TERMINAL), &click(130.0, 70.0), DeliveryMode::Foreground)
        .unwrap();

    let calls = input.server.calls();
    assert_eq!(calls.first(), Some(&Call::Activate(TERMINAL)));
    assert_eq!(calls.last(), Some(&Call::Activate(EDITOR)));
    assert!(calls[1..calls.len() - 1].contains(&fake_button(true)));
    assert_eq!(input.active_window(), before);
}

#[test]
fn foreground_delivery_to_a_filtering_toolkit_uses_xtest() {
    let mut input = input();

    input
        .type_text(&window(GTK_APP), "a", DeliveryMode::Foreground)
        .unwrap();

    assert!(input.server.calls().contains(&fake_key(KEY_A, true)));
}

#[test]
fn a_shifted_character_is_typed_with_shift_held_around_it() {
    let mut input = input();

    input
        .type_text(&Target::Desktop, "A", DeliveryMode::Background)
        .unwrap();

    assert_eq!(
        input.server.calls(),
        [
            fake_key(KEY_SHIFT_L, true),
            fake_key(KEY_A, true),
            fake_key(KEY_A, false),
            fake_key(KEY_SHIFT_L, false),
        ]
    );
}

#[test]
fn background_chord_events_carry_the_modifiers_held_before_them() {
    let mut input = input();

    input
        .key_chord(
            &window(TERMINAL),
            &[KeyName::Ctrl, KeyName::Char('c')],
            DeliveryMode::Background,
        )
        .unwrap();

    let key = |code, press, state| Call::Send(TERMINAL, SentEvent::Key { code, press, state });
    let control = 1 << 2;
    assert_eq!(
        input.server.calls(),
        [
            key(KEY_CONTROL_L, true, 0),
            key(KEY_C, true, control),
            key(KEY_C, false, control),
            key(KEY_CONTROL_L, false, control),
        ]
    );
}

#[test]
fn a_character_the_keymap_cannot_type_is_rejected_before_any_key_is_sent() {
    let mut input = input();

    let error = input
        .type_text(&Target::Desktop, "a\u{2603}", DeliveryMode::Background)
        .unwrap_err();

    assert_eq!(error.code, ErrorCode::InvalidKey);
    assert!(input.server.calls().is_empty());
}

#[test]
fn cursor_position_and_warp_use_root_coordinates() {
    let input = input();
    input.server.pointer.set((12, 34));

    let position = input.cursor_position().unwrap();
    input
        .warp_cursor(senpi_desktop_core::types::DesktopPoint { x: 5.0, y: 6.0 })
        .unwrap();

    assert_eq!((position.x, position.y), (12.0, 34.0));
    assert_eq!(input.server.calls(), [Call::Warp(5, 6)]);
}

#[test]
fn a_malformed_window_id_is_window_not_found() {
    let mut input = input();

    let error = input
        .pointer(
            &Target::Window("0xnope".into()),
            &click(1.0, 1.0),
            DeliveryMode::Background,
        )
        .unwrap_err();

    assert_eq!(error.code, ErrorCode::WindowNotFound);
}
