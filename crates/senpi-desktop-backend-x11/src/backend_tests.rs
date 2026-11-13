//! `X11Backend` over the in-memory capture server and the recording input
//! server: capabilities measured from what connected, and the focus-guard
//! hooks the session transaction calls.

mod restore_tests;

use senpi_desktop_core::backend::{Backend, DeliveryMode, Modifiers, MouseButton, PointerEvent};
use senpi_desktop_core::error::{DesktopError, ErrorCode};
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::types::{DesktopPoint, DisplaySelector, FrontWindow, Target};
use x11rb::protocol::xproto::AtomEnum;

use crate::capture::fake::{viewable, FakeServer};
use crate::capture::X11Capture;
use crate::input::fake::{Call, FakeInputServer};
use crate::input::X11Input;
use crate::X11Backend;

const EDITOR: u32 = 0x80_0001;
const TERMINAL: u32 = 0x40_0001;
const BROWSER: u32 = 0x90_0001;

fn capture() -> X11Capture<FakeServer> {
    let server = FakeServer::new(1280, 800)
        .monitor("DP-1", (0, 0, 1280, 800), true)
        .root_words("_NET_CLIENT_LIST", AtomEnum::WINDOW, &[EDITOR, TERMINAL])
        .window(EDITOR, viewable(0, 0, 400, 300))
        .window(TERMINAL, viewable(500, 0, 400, 300));
    let server = server
        .words_on(EDITOR, "_NET_WM_PID", AtomEnum::CARDINAL.into(), &[4242])
        .bytes_on(
            EDITOR,
            AtomEnum::WM_CLASS.into(),
            AtomEnum::STRING.into(),
            b"gedit\0Gedit\0",
        );
    X11Capture::with_server(server, DisplaySelector::All).unwrap()
}

fn backend(input: Result<FakeInputServer, DesktopError>) -> X11Backend<FakeServer, FakeInputServer> {
    X11Backend::with_parts(capture(), input.map(X11Input::with_server), Some(":99".into()))
}

fn no_xtest() -> DesktopError {
    DesktopError::input_failed("XTEST extension is unavailable")
}

#[test]
fn capabilities_advertise_both_delivery_modes_and_the_focus_guard_once_xtest_is_up() {
    let mut backend = backend(Ok(FakeInputServer::new(Some(EDITOR))));

    let caps = Backend::capabilities(&mut backend);

    assert_eq!(
        (caps.backend.as_str(), caps.capture, caps.display_count),
        ("x11", true, 1)
    );
    assert_eq!(
        (
            caps.input,
            caps.input_permission.as_str(),
            caps.background_window_input
        ),
        (true, "granted", true)
    );
    assert_eq!(caps.delivery_modes, ["background", "foreground"]);
    assert!(caps.focus_guard);
    assert_eq!((caps.ax, caps.ax_permission.as_str()), (false, "bus-unreachable"));
}

#[test]
fn capabilities_withhold_input_without_xtest_and_keep_the_core_focus_guard_without_ewmh() {
    let mut without_xtest = backend(Err(no_xtest()));
    let mut without_wm = backend(Ok(FakeInputServer::new(None)));

    let (no_input, no_guard) = (
        Backend::capabilities(&mut without_xtest),
        Backend::capabilities(&mut without_wm),
    );

    assert_eq!(
        (
            no_input.input,
            no_input.input_permission.as_str(),
            no_input.background_window_input
        ),
        (false, "unavailable", false)
    );
    assert!(no_input.delivery_modes.is_empty() && !no_input.focus_guard);
    assert!(no_guard.input && no_guard.focus_guard);
}

#[test]
fn capabilities_report_capture_unavailable_when_the_display_is_gone() {
    let capture =
        X11Capture::with_server(FakeServer::new(1280, 800), DisplaySelector::Id("DP-9".into())).unwrap();
    let mut backend = X11Backend::with_parts(
        capture,
        Ok(X11Input::with_server(FakeInputServer::new(None))),
        None,
    );

    let caps = Backend::capabilities(&mut backend);

    assert_eq!(
        (caps.capture, caps.capture_permission.as_str(), caps.display_count),
        (false, "unavailable", 0)
    );
}

#[test]
fn input_without_xtest_fails_with_the_gate_reason_and_release_all_has_nothing_to_do() {
    let mut backend = backend(Err(no_xtest()));

    let error = backend
        .type_text(&Target::Desktop, "a", DeliveryMode::Background)
        .unwrap_err();

    assert_eq!(error, no_xtest());
    assert_eq!(backend.release_all(), Ok(()));
    assert_eq!(backend.cursor_position(), Ok(None));
}

#[test]
fn the_front_window_is_the_active_window_with_its_pid_and_application() {
    let mut backend = backend(Ok(FakeInputServer::new(Some(EDITOR))));

    let front = backend.front_window().unwrap();

    assert_eq!(
        front,
        Some(FrontWindow {
            pid: 4242,
            window_id: Some(EDITOR.to_string()),
            app: "Gedit".into(),
            key_window_ax_title: None,
        })
    );
}

#[test]
fn foreground_input_restores_the_front_window_without_a_duplicate_restore() {
    let mut backend = backend(Ok(FakeInputServer::new(Some(EDITOR))));
    let front = backend.front_window().unwrap().unwrap();
    let event = PointerEvent::Click {
        x: 510.0,
        y: 10.0,
        button: MouseButton::Left,
        count: 1,
        modifiers: Modifiers::default(),
    };
    backend
        .pointer(
            &Target::Window(TERMINAL.to_string()),
            event,
            &FrameGeometry::identity_global(),
            DeliveryMode::Foreground,
        )
        .unwrap();

    backend.restore_front_window(&front).unwrap();

    let input = backend.input_ref().unwrap();
    assert_eq!(input.active_window(), Some(EDITOR));
    let activations: Vec<_> = input
        .server()
        .calls()
        .into_iter()
        .filter(|call| matches!(call, Call::Activate(_)))
        .collect();
    assert_eq!(activations, [Call::Activate(TERMINAL), Call::Activate(EDITOR)]);
}

#[test]
fn restore_front_window_preserves_a_newer_user_focus() {
    let mut backend = backend(Ok(FakeInputServer::new(Some(EDITOR))));
    let front = backend.front_window().unwrap().unwrap();
    let event = PointerEvent::Click {
        x: 510.0,
        y: 10.0,
        button: MouseButton::Left,
        count: 1,
        modifiers: Modifiers::default(),
    };
    backend
        .pointer(
            &Target::Window(TERMINAL.to_string()),
            event,
            &FrameGeometry::identity_global(),
            DeliveryMode::Foreground,
        )
        .unwrap();
    backend.input_ref().unwrap().server().active.set(Some(BROWSER));

    backend.restore_front_window(&front).unwrap();

    assert_eq!(backend.input_ref().unwrap().active_window(), Some(BROWSER));
}

#[test]
fn restore_cursor_preserves_a_newer_user_pointer_position() {
    let mut backend = backend(Ok(FakeInputServer::new(Some(EDITOR))));
    let event = PointerEvent::Click {
        x: 510.0,
        y: 10.0,
        button: MouseButton::Left,
        count: 1,
        modifiers: Modifiers::default(),
    };
    backend
        .pointer(
            &Target::Window(TERMINAL.to_string()),
            event,
            &FrameGeometry::identity_global(),
            DeliveryMode::Foreground,
        )
        .unwrap();
    let input = backend.input_ref().unwrap();
    input.server().pointer.set((900, 700));
    input.server().calls.borrow_mut().clear();

    backend
        .warp_cursor(DesktopPoint { x: 12.0, y: 34.0 })
        .unwrap();

    assert_eq!(backend.input_ref().unwrap().server().pointer.get(), (900, 700));
    assert!(
        !backend
            .input_ref()
            .unwrap()
            .server()
            .calls()
            .contains(&Call::Warp(12, 34))
    );
}

#[test]
fn raising_an_unknown_window_is_window_not_found_and_activates_nothing() {
    let mut backend = backend(Ok(FakeInputServer::new(Some(EDITOR))));

    let error = backend.raise_window("12345").unwrap_err();

    assert_eq!(error.code, ErrorCode::WindowNotFound);
    assert!(backend.input_ref().unwrap().server().calls().is_empty());
}
