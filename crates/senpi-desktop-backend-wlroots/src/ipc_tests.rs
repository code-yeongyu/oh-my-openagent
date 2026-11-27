//! ipc: fixture parsing, the tree walk, and the round-trip framing against
//! a fake sway socket.

use super::test_support::{FakeSway, FakeSwayIpc, TREE_JSON};
use crate::ipc::{self, message, SwayIpc, SwaySocket};

#[test]
fn outputs_parse_into_displays_with_scale_and_pixels() {
    let mut fake = FakeSwayIpc::default();
    let displays = ipc::outputs(&mut fake).expect("outputs");

    assert_eq!(displays.len(), 1);
    let display = &displays[0];
    assert_eq!(
        (display.id.as_str(), display.name.as_str()),
        ("HDMI-A-1", "RZD HDMI")
    );
    assert_eq!(
        (display.x, display.y, display.width, display.height),
        (0, 0, 1920, 1200)
    );
    assert_eq!(display.scale, 1.0);
    assert_eq!((display.pixel_width, display.pixel_height), (1920, 1200));
    assert!(!display.is_primary);
}

#[test]
fn the_tree_lists_wayland_and_xwayland_windows_and_the_active_output() {
    let mut fake = FakeSwayIpc::default();
    let tree = ipc::tree(&mut fake).expect("tree");
    let (windows, active) = tree.windows();

    assert_eq!(active.as_deref(), Some("HDMI-A-1"));
    let kitty = windows
        .iter()
        .find(|window| window.id == "12")
        .expect("kitty window");
    assert_eq!(
        (kitty.title.as_str(), kitty.app.as_str(), kitty.pid),
        ("archlinux: dori", "kitty", Some(1311138))
    );
    assert_eq!(
        (kitty.x, kitty.y, kitty.width, kitty.height),
        (20, 56, 1880, 1124)
    );
    assert!(kitty.focused);
    let floaty = windows
        .iter()
        .find(|window| window.id == "15")
        .expect("floating window");
    assert_eq!(floaty.app.as_str(), "XFloat");
    assert!(!floaty.focused);
    // Workspaces and outputs are not windows.
    assert_eq!(windows.len(), 2);
}

#[test]
fn find_locates_a_window_leaf_anywhere_in_the_tree() {
    let tree: ipc::SwayNode = serde_json::from_str(TREE_JSON).expect("tree");
    assert!(tree.find("12").is_some());
    assert!(tree.find("15").is_some());
    assert!(tree.find("11").is_none());
    assert!(tree.find("9999").is_none());
}

#[test]
fn run_command_sends_the_command_and_checks_success() {
    let mut fake = FakeSwayIpc::default();
    ipc::run_command(&mut fake, "[con_id=12] focus").expect("focus");

    let (kind, payload) = &fake.requests.lock().unwrap()[0];
    assert_eq!(*kind, message::RUN_COMMAND);
    assert_eq!(payload, b"[con_id=12] focus");
}

#[test]
fn subscribe_sends_the_event_list() {
    let mut fake = FakeSwayIpc::default();
    ipc::subscribe(&mut fake, &["binding"]).expect("subscribe");

    let (kind, payload) = &fake.requests.lock().unwrap()[0];
    assert_eq!(*kind, message::SUBSCRIBE);
    assert_eq!(payload, br#"["binding"]"#);
}

#[test]
fn the_socket_round_trips_framing_against_a_fake_sway() {
    let fake = FakeSway::start();
    let mut socket = SwaySocket::connect(&fake.path).expect("connect");

    let reply = socket
        .round_trip(message::SUBSCRIBE, br#"["binding"]"#)
        .expect("subscribe round trip");

    assert_eq!(reply, br#"{"success": true}"#.to_vec());
    assert_eq!(fake.subscribed_to().as_deref(), Some(r#"["binding"]"#));
}

#[test]
fn a_missing_socket_fails_to_connect() {
    let dir = tempfile::tempdir().expect("tempdir");
    let gone = dir.path().join("no-such.sock");
    let error = SwaySocket::connect(&gone).err().expect("no socket");
    assert!(error.message.contains("sway IPC"));
}

#[test]
fn the_socket_selection_helper_only_accepts_living_sockets() {
    use crate::sway_socket_path;

    let set = |name: &str| {
        if name == "SWAYSOCK" {
            Some(std::ffi::OsString::from("/nonexistent/sway.sock"))
        } else {
            None
        }
    };
    assert_eq!(sway_socket_path(&set), None);

    let listener_dir = tempfile::tempdir().expect("tempdir");
    let socket = listener_dir.path().join("sway.sock");
    let _listener = std::os::unix::net::UnixListener::bind(&socket).expect("bind");
    let live = |name: &str| {
        if name == "SWAYSOCK" {
            Some(socket.clone().into_os_string())
        } else {
            None
        }
    };
    assert_eq!(sway_socket_path(&live), Some(socket));
}

#[test]
fn a_plain_file_named_like_a_socket_is_not_selected() {
    use crate::sway_socket_path;

    let dir = tempfile::tempdir().expect("tempdir");
    let plain = dir.path().join("not-a-socket");
    std::fs::write(&plain, b"i3-ipc").expect("write");
    let set = |name: &str| {
        if name == "SWAYSOCK" {
            Some(plain.clone().into_os_string())
        } else {
            None
        }
    };
    assert_eq!(sway_socket_path(&set), None);
}

#[test]
fn a_socket_file_without_a_listener_is_refused() {
    // A socket file outlives its listener: only a connection proves a live
    // compositor, so a stale path is not selected.
    use crate::sway_socket_path;

    let dir = tempfile::tempdir().expect("tempdir");
    let stale = dir.path().join("stale.sock");
    let listener = std::os::unix::net::UnixListener::bind(&stale).expect("bind");
    drop(listener);

    let set = |name: &str| {
        if name == "SWAYSOCK" {
            Some(stale.clone().into_os_string())
        } else {
            None
        }
    };
    assert_eq!(sway_socket_path(&set), None);
}

#[test]
fn the_event_reader_returns_the_payload_and_none_on_wake() {
    let mut fake = FakeSway::start();
    let mut socket = SwaySocket::connect(&fake.path).expect("connect");
    socket
        .set_event_read_timeout(std::time::Duration::from_millis(50))
        .expect("timeout");

    assert_eq!(socket.next_event().expect("no event yet"), None);

    fake.send_binding_event(r#"{"change":"run","binding":{"event_state_mask":["Ctrl"],"symbol":"Escape","input_type":"keyboard"}}"#);
    let payload = socket.next_event().expect("event").expect("payload");
    let text = String::from_utf8_lossy(&payload);
    assert!(text.contains("\"Escape\""));
}

/// The i3-ipc framing of one event, split up by the caller as the test
/// wants.
fn event_frame(payload: &[u8]) -> Vec<u8> {
    let mut frame = Vec::with_capacity(14 + payload.len());
    frame.extend_from_slice(b"i3-ipc");
    frame.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    frame.extend_from_slice(&ipc::event::BINDING.to_le_bytes());
    frame.extend_from_slice(payload);
    frame
}

#[test]
fn a_split_header_fails_honestly_without_losing_the_framing() {
    let mut fake = FakeSway::start();
    let mut socket = SwaySocket::connect(&fake.path).expect("connect");
    socket
        .set_event_read_timeout(std::time::Duration::from_millis(40))
        .expect("timeout");

    // Half a header and nothing more: the reader keeps the partial frame
    // and fails at the completion deadline instead of reading garbage.
    fake.send_raw(b"i3-ipc");
    let error = socket
        .next_event()
        .expect_err("split header never completed");
    assert!(error.message.contains("never completed"));
}

#[test]
fn a_header_without_its_payload_never_returns_a_frame() {
    let mut fake = FakeSway::start();
    let mut socket = SwaySocket::connect(&fake.path).expect("connect");
    socket
        .set_event_read_timeout(std::time::Duration::from_millis(40))
        .expect("timeout");

    // The timeout lands between the header and the first payload byte; the
    // started frame must complete or fail, never read the next frame's bytes
    // as this frame's payload.
    let frame = event_frame(br#"{"change":"run"}"#);
    fake.send_raw(&frame[..14]);
    let error = socket.next_event().expect_err("payload never arrived");
    assert!(error.message.contains("never completed"));
}

#[test]
fn a_partial_payload_completes_when_its_rest_arrives() {
    let mut fake = FakeSway::start();
    let mut socket = SwaySocket::connect(&fake.path).expect("connect");
    socket
        .set_event_read_timeout(std::time::Duration::from_millis(40))
        .expect("timeout");

    let frame = event_frame(br#"{"change":"run"}"#);
    fake.send_raw(&frame[..14 + 4]);
    let (done, received) = std::sync::mpsc::channel();
    let reader = std::thread::spawn(move || {
        let _ = done.send(socket.next_event());
    });

    // The reader holds the partial frame; the remainder completes it.
    fake.send_raw(&frame[14 + 4..]);
    let payload = received
        .recv_timeout(std::time::Duration::from_secs(2))
        .expect("reader finished")
        .expect("frame read")
        .expect("payload");
    reader.join().expect("reader thread");
    assert_eq!(payload, br#"{"change":"run"}"#.to_vec());
}
