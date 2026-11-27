//! Background input is never reported delivered when nothing shows the target
//! accepts `XSendEvent` input (omo#9109): a GTK 3 app run from a script has a
//! `WM_CLASS` that names the script, not GTK, and drops every synthetic event,
//! so sending to it and returning success would be a false delivery.

use senpi_desktop_core::backend::{DeliveryMode, Modifiers, MouseButton, PointerEvent};
use senpi_desktop_core::error::{DesktopError, ErrorCode};
use senpi_desktop_core::keys::KeyName;
use senpi_desktop_core::report::Disposition;
use senpi_desktop_core::types::Target;
use x11rb::protocol::xproto::Window;

use super::fake::FakeInputServer;
use super::X11Input;

const EDITOR: Window = 0x80_0001;
/// The conformance fixture's own class: `fixture.py` names no toolkit.
const FIXTURE: Window = 0x70_0001;
const FIXTURE_CLASS: &[u8] = b"fixture.py\0Fixture.py\0";
const PYTHON_GTK: [&str; 3] = ["libpython3.12.so.1.0", "libgtk-3.so.0", "libX11.so.6"];

fn server() -> FakeInputServer {
    FakeInputServer::new(Some(EDITOR)).window(FIXTURE, (2, 40), FIXTURE_CLASS)
}

/// A click, a scroll, typing and a chord in the background; each result and
/// how many events reached the server in total.
fn background_attempts(server: FakeInputServer) -> (Vec<Result<(), DesktopError>>, usize) {
    let target = Target::Window(FIXTURE.to_string());
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
    let results = vec![
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
    (results, sent)
}

/// Every attempt is a `BackgroundUnavailable` refusal with `reason`, safe to
/// retry, and nothing was sent.
fn assert_refused(server: FakeInputServer, reason: &str) -> Vec<String> {
    let (results, sent) = background_attempts(server);
    assert_eq!(sent, 0, "no input may be sent");
    results
        .into_iter()
        .map(|result| {
            let error = result.expect_err("background input must not report delivered");
            assert_eq!(error.code, ErrorCode::BackgroundUnavailable, "{}", error.message);
            let report = error.report.as_deref().expect("refusal report");
            assert_eq!(report.reason.as_deref(), Some(reason));
            assert_eq!(report.disposition, Some(Disposition::NOT_DELIVERED_SAFE));
            error.message
        })
        .collect()
}

#[test]
fn background_input_to_a_window_whose_process_cannot_be_inspected_is_refused_and_sends_nothing() {
    // Given: an unlisted class and no readable client process.
    // When / Then: every background kind is refused before any event is sent.
    assert_refused(server(), "synthetic_input_unproven");
}

#[test]
fn a_gtk_app_with_an_unlisted_class_is_refused_by_the_library_its_process_maps() {
    // Given: the fixture's process maps GTK 3.
    let server = server().process(FIXTURE, &PYTHON_GTK, &["python3", "fixture.py"]);
    // When / Then
    for message in assert_refused(server, "synthetic_input_dropped") {
        assert!(message.contains("libgtk-3.so.0"), "{message}");
    }
}

#[test]
fn a_chromium_helper_tree_is_refused_even_without_a_toolkit_library() {
    // Given: a statically linked Chromium shell with helper children.
    let server = server()
        .process(FIXTURE, &["libX11.so.6", "libnss3.so"], &["/opt/app/app"])
        .with_chromium_helpers(FIXTURE);
    // When / Then
    assert_refused(server, "synthetic_input_dropped");
}

#[test]
fn a_client_with_no_toolkit_known_to_accept_synthetic_input_is_refused() {
    // Given: only Xlib is mapped.
    let server = server().process(FIXTURE, &["libX11.so.6"], &["/usr/bin/app"]);
    // When / Then
    assert_refused(server, "synthetic_input_unproven");
}

#[test]
fn xterm_is_refused_even_when_the_resources_the_engine_can_read_allow_send_events() {
    // Given: -xrm sets allowSendEvents true, then the abbreviated -xr (Xt accepts it) sets it false;
    // XENVIRONMENT, ~/.Xdefaults-<host>, app-defaults and the runtime menu can override it unseen.
    let xterm = |args: &[&str]| {
        FakeInputServer::new(Some(EDITOR))
            .window(FIXTURE, (2, 40), b"xterm\0XTerm\0")
            .process(FIXTURE, &["libXaw.so.7", "libXt.so.6"], args)
    };
    // When / Then: whatever the visible sources say, delivery to xterm is not known.
    assert_refused(
        xterm(&["xterm", "-xrm", "XTerm*allowSendEvents: true", "-xr", "XTerm*allowSendEvents: false"]),
        "synthetic_input_dropped",
    );
    assert_refused(xterm(&["xterm", "-xrm", "XTerm*allowSendEvents: true"]), "synthetic_input_dropped");
}

#[test]
fn an_xterm_binary_under_another_name_and_class_is_refused() {
    // Given: xterm run through a renamed link with -name/-class overridden; only its exe link names xterm.
    let server = FakeInputServer::new(Some(EDITOR))
        .window(FIXTURE, (2, 40), b"myterm\0MyTerm\0")
        .process(
            FIXTURE,
            &["libXaw.so.7", "libXt.so.6"],
            &["/usr/local/bin/myterm", "-name", "myterm", "-class", "MyTerm"],
        )
        .with_exe(FIXTURE, "/usr/bin/xterm");
    // When / Then
    assert_refused(server, "synthetic_input_dropped");
}

#[test]
fn a_window_embedded_from_a_gtk_process_is_refused_inside_an_accepting_shell() {
    // Given: a Tk shell whose area under the point is a plug window of a GTK process.
    const PLUG: Window = 0x90_0002;
    let server = server()
        .process(FIXTURE, &["libtk8.6.so"], &["wish"])
        .child(FIXTURE, PLUG)
        .process(PLUG, &PYTHON_GTK, &["python3", "plug.py"]);
    let click = PointerEvent::Click {
        x: 321.0,
        y: 70.0,
        button: MouseButton::Left,
        count: 1,
        modifiers: Modifiers::default(),
    };
    let mut input = X11Input::with_server(server);
    // When
    let error = input
        .pointer(&Target::Window(FIXTURE.to_string()), &click, DeliveryMode::Background)
        .expect_err("the plug drops synthetic input");
    // Then
    assert_eq!(error.code, ErrorCode::BackgroundUnavailable);
    assert!(error.message.contains("libgtk-3.so.0"), "{}", error.message);
    assert!(input.server().calls().is_empty(), "no input may be sent");
}

#[test]
fn a_tk_app_with_an_unlisted_class_takes_background_input() {
    // Given: a Tk client, whose toolkit dispatches sent events.
    let server = server().process(FIXTURE, &["libtk8.6.so", "libX11.so.6"], &["wish"]);
    // When
    let (results, sent) = background_attempts(server);
    // Then
    assert!(results.iter().all(Result::is_ok), "{results:?}");
    assert!(sent > 0);
}
