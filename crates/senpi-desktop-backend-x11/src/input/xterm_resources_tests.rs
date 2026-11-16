//! xterm's `allowSendEvents` as Xrm resolves it for the target client:
//! an entry for another application, a setting for another widget, or a
//! more specific `false` never lets background input count as delivered.

use senpi_desktop_core::backend::{DeliveryMode, Modifiers, MouseButton, PointerEvent};
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::types::Target;
use x11rb::protocol::xproto::Window;

use super::fake::FakeInputServer;
use super::X11Input;

const XTERM: Window = 0x40_0001;

/// Whether a background click to an xterm with `database` and `args` is
/// sent (`true`) or refused as `BackgroundUnavailable` with nothing sent.
fn sent(database: &str, args: &[&str]) -> bool {
    let server = FakeInputServer::new(Some(0x80_0001))
        .window(XTERM, (0, 0), b"xterm\0XTerm\0")
        .process(XTERM, &["libXaw.so.7", "libXt.so.6"], args)
        .resources(database.as_bytes());
    let mut input = X11Input::with_server(server);
    let click = PointerEvent::Click {
        x: 5.0,
        y: 5.0,
        button: MouseButton::Left,
        count: 1,
        modifiers: Modifiers::default(),
    };
    match input.pointer(&Target::Window(XTERM.to_string()), &click, DeliveryMode::Background) {
        Ok(()) => true,
        Err(error) => {
            assert_eq!(error.code, ErrorCode::BackgroundUnavailable, "{}", error.message);
            assert!(input.server().calls().is_empty(), "a refusal sends nothing");
            false
        }
    }
}

#[test]
fn an_entry_for_another_application_class_does_not_enable_this_xterm() {
    // Given: only UXTerm (uxterm's class) allows sent events; the target's class is XTerm.
    // When / Then
    assert!(!sent("UXTerm*allowSendEvents: true\n", &["xterm"]));
    assert!(!sent("", &["xterm", "-xrm", "OtherApp*allowSendEvents: true"]));
}

#[test]
fn a_more_specific_false_wins_over_a_looser_true_listed_later() {
    // Given: Xrm prefers the entry naming the application over a loose one, whatever the order.
    let database = "xterm*allowSendEvents: false\n*allowSendEvents: true\n";
    // When / Then
    assert!(!sent(database, &["xterm"]));
    assert!(!sent("xterm*allowSendEvents: false\n", &["xterm", "-xrm", "*allowSendEvents: true"]));
}

#[test]
fn a_setting_for_another_widget_does_not_enable_the_terminal() {
    // Given: allowSendEvents is set on the menu widget, not on vt100.
    // When / Then
    assert!(!sent("xterm.mainMenu.allowSendEvents: true\n", &["xterm"]));
}

#[test]
fn entries_that_name_this_xterm_enable_it() {
    // Given / When / Then: by class, by instance, loosely, and from -xrm.
    assert!(sent("XTerm*allowSendEvents: true\n", &["xterm"]));
    assert!(sent("xterm*VT100.allowSendEvents: on\n", &["xterm"]));
    assert!(sent("*allowSendEvents:\tTrue\n", &["xterm"]));
    assert!(sent("! a comment\n", &["xterm", "-xrm", "XTerm*allowSendEvents: true"]));
}
