//! Background pointer events name the widget under the point: Xt and most
//! toolkits dispatch a sent event by its event window, so an event sent to a
//! top-level shell with a child widget over the point never reaches it.

use senpi_desktop_core::backend::{DeliveryMode, Modifiers, MouseButton, PointerEvent};
use senpi_desktop_core::types::Target;
use x11rb::protocol::xproto::Window;

use super::fake::{Call, FakeInputServer};
use super::server::SentEvent;
use super::X11Input;

const SHELL: Window = 0x40_0001;
const VT100: Window = 0x40_0002;

#[test]
fn a_background_click_is_sent_to_the_child_widget_under_the_point() {
    // Given: an xterm-like shell whose VT100 widget covers its client area.
    let mut input = X11Input::with_server(
        FakeInputServer::new(Some(0x80_0001))
            .window(SHELL, (100, 50), b"xterm\0XTerm\0")
            .child(SHELL, VT100),
    );
    let click = PointerEvent::Click {
        x: 130.0,
        y: 70.0,
        button: MouseButton::Middle,
        count: 1,
        modifiers: Modifiers::default(),
    };
    // When
    input
        .pointer(
            &Target::Window(SHELL.to_string()),
            &click,
            DeliveryMode::Background,
        )
        .expect("click");
    // Then: both button events name the child, never the shell.
    let windows: Vec<Window> = input
        .server
        .calls()
        .into_iter()
        .filter_map(|call| match call {
            Call::Send(window, SentEvent::Button { .. }) => Some(window),
            _ => None,
        })
        .collect();
    assert_eq!(windows, [VT100, VT100]);
}
