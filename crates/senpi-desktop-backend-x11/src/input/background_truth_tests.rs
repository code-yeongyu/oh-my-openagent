//! Background input is never reported delivered when nothing shows the target
//! accepts `XSendEvent` input (omo#9109): a GTK 3 app run from a script has a
//! `WM_CLASS` that names the script, not GTK, and drops every synthetic event,
//! so sending to it and returning success would be a false delivery.

use senpi_desktop_core::backend::{DeliveryMode, Modifiers, MouseButton, PointerEvent};
use senpi_desktop_core::error::{DesktopError, ErrorCode};
use senpi_desktop_core::keys::KeyName;
use senpi_desktop_core::types::Target;
use x11rb::protocol::xproto::Window;

use super::fake::FakeInputServer;
use super::X11Input;

const EDITOR: Window = 0x80_0001;
/// The conformance fixture's own class: `fixture.py` names no toolkit.
const FIXTURE: Window = 0x70_0001;
const FIXTURE_CLASS: &[u8] = b"fixture.py\0Fixture.py\0";

fn background_attempts(server: FakeInputServer, window: Window) -> Vec<(DesktopError, usize)> {
    let target = Target::Window(window.to_string());
    let click = PointerEvent::Click {
        x: 321.0,
        y: 70.0,
        button: MouseButton::Left,
        count: 1,
        modifiers: Modifiers::default(),
    };
    let scroll = PointerEvent::Scroll {
        x: 321.0,
        y: 469.0,
        dx: 0.0,
        dy: 3.0,
    };
    let mut input = X11Input::with_server(server);
    let results = [
        input.pointer(&target, &click, DeliveryMode::Background),
        input.pointer(&target, &scroll, DeliveryMode::Background),
        input.type_text(&target, "a", DeliveryMode::Background),
        input.key_chord(
            &target,
            &[KeyName::Ctrl, KeyName::Char('c')],
            DeliveryMode::Background,
        ),
    ];
    let sent = input.server().calls().len();
    results
        .into_iter()
        .map(|result| (result.expect_err("background input must not report delivered"), sent))
        .collect()
}

#[test]
fn background_input_to_a_window_whose_process_cannot_be_inspected_is_refused_and_sends_nothing() {
    // Given: an unlisted class and no readable client process.
    let server = FakeInputServer::new(Some(EDITOR)).window(FIXTURE, (2, 40), FIXTURE_CLASS);
    // When / Then: every background kind is refused before any event is sent.
    for (error, sent) in background_attempts(server, FIXTURE) {
        assert_eq!(error.code, ErrorCode::BackgroundUnavailable, "{}", error.message);
        assert_eq!(sent, 0, "no input may be sent");
    }
}
