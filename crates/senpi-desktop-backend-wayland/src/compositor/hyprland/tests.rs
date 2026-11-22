//! Hyprland IPC parsing, placement, detection and the IPC round trip.

use std::os::unix::net::UnixListener;
use std::thread::JoinHandle;

use senpi_desktop_core::error::ErrorCode;

use super::*;

/// `hyprctl -j clients` on Hyprland 0.45 (trimmed to four windows):
/// a tiled terminal and editor on workspace 1, a floating dialog of the
/// editor, and a window on hidden workspace 3.
pub const CLIENTS: &str = r#"[
  {"address":"0x5f0c4d0a7d10","mapped":true,"hidden":false,"at":[10,48],"size":[1260,1012],
   "workspace":{"id":1,"name":"1"},"floating":false,"pseudo":false,"monitor":0,"class":"kitty",
   "title":"~","initialClass":"kitty","initialTitle":"kitty","pid":1201,"xwayland":false,
   "pinned":false,"fullscreen":0,"fullscreenClient":0,"grouped":[],"tags":[],"swallowing":"0x0",
   "focusHistoryID":1,"inhibitingIdle":false},
  {"address":"0x5f0c4d0b1e20","mapped":true,"hidden":false,"at":[1290,48],"size":[1260,1012],
   "workspace":{"id":1,"name":"1"},"floating":false,"pseudo":false,"monitor":0,"class":"gedit",
   "title":"notes.txt","initialClass":"gedit","initialTitle":"gedit","pid":1302,"xwayland":false,
   "pinned":false,"fullscreen":0,"fullscreenClient":0,"grouped":[],"tags":[],"swallowing":"0x0",
   "focusHistoryID":0,"inhibitingIdle":false},
  {"address":"0x5f0c4d0c2f30","mapped":true,"hidden":false,"at":[1500,300],"size":[600,400],
   "workspace":{"id":1,"name":"1"},"floating":true,"pseudo":false,"monitor":0,"class":"gedit",
   "title":"Save As","initialClass":"gedit","initialTitle":"gedit","pid":1302,"xwayland":false,
   "pinned":false,"fullscreen":0,"fullscreenClient":0,"grouped":[],"tags":[],"swallowing":"0x0",
   "focusHistoryID":2,"inhibitingIdle":false},
  {"address":"0x5f0c4d0d3a40","mapped":true,"hidden":false,"at":[2570,48],"size":[1000,800],
   "workspace":{"id":3,"name":"3"},"floating":false,"pseudo":false,"monitor":1,"class":"firefox",
   "title":"Docs","initialClass":"firefox","initialTitle":"Firefox","pid":1403,"xwayland":false,
   "pinned":false,"fullscreen":0,"fullscreenClient":0,"grouped":[],"tags":[],"swallowing":"0x0",
   "focusHistoryID":3,"inhibitingIdle":false}
]"#;

/// `hyprctl -j monitors`: DP-1 shows workspace 1, HDMI-A-1 workspace 2.
pub const MONITORS: &str = r#"[
  {"id":0,"name":"DP-1","description":"Dell U2720Q","make":"Dell","model":"U2720Q","serial":"",
   "width":2560,"height":1440,"refreshRate":59.95,"x":0,"y":0,"activeWorkspace":{"id":1,"name":"1"},
   "specialWorkspace":{"id":0,"name":""},"reserved":[0,0,0,0],"scale":1.00,"transform":0,
   "focused":true,"dpmsStatus":true,"vrr":false,"disabled":false,"availableModes":[]},
  {"id":1,"name":"HDMI-A-1","description":"","make":"","model":"","serial":"","width":1920,
   "height":1080,"refreshRate":60.0,"x":2560,"y":0,"activeWorkspace":{"id":2,"name":"2"},
   "specialWorkspace":{"id":0,"name":""},"reserved":[0,0,0,0],"scale":1.00,"transform":0,
   "focused":false,"dpmsStatus":true,"vrr":false,"disabled":false,"availableModes":[]}
]"#;

pub fn window(pid: Option<u32>, title: &str) -> DesktopWindow {
    DesktopWindow {
        id: "atspi::1.31:/org/a11y/atspi/accessible/7".to_owned(),
        title: title.to_owned(),
        app: "app".to_owned(),
        pid,
        x: 0,
        y: 0,
        width: 1260,
        height: 1012,
        focused: false,
        is_on_screen: None,
        elevated: None,
        identity: None,
    }
}

fn placed(pid: Option<u32>, title: &str) -> CoreResult<Placement> {
    let clients = parse_clients(CLIENTS).expect("clients parse");
    let monitors = parse_monitors(MONITORS).expect("monitors parse");
    place(&clients, &monitors, &window(pid, title))
}

/// Serves `replies` (request -> reply) on a socket at
/// `<runtime>/hypr/<signature>/.socket.sock`, one request per connection.
pub fn serve(
    runtime: &Path,
    signature: &str,
    replies: Vec<(&'static str, &'static str)>,
) -> JoinHandle<Vec<String>> {
    let dir = runtime.join("hypr").join(signature);
    std::fs::create_dir_all(&dir).expect("hypr dir");
    let listener = UnixListener::bind(dir.join(SOCKET_NAME)).expect("bind hyprland socket");
    std::thread::spawn(move || {
        let mut seen = Vec::new();
        for _ in 0..replies.len() {
            let (mut stream, _) = listener.accept().expect("accept");
            let mut request = String::new();
            stream.read_to_string(&mut request).expect("read request");
            let reply = replies
                .iter()
                .find(|(command, _)| *command == request)
                .map_or("unknown request", |(_, reply)| *reply);
            stream.write_all(reply.as_bytes()).expect("write reply");
            seen.push(request);
        }
        seen
    })
}

#[test]
fn clients_reply_parses_geometry_and_identity() {
    let clients = parse_clients(CLIENTS).expect("clients parse");

    assert_eq!(clients.len(), 4);
    assert_eq!(clients[1].address, "0x5f0c4d0b1e20");
    assert_eq!(clients[1].pid, 1302);
    assert_eq!(
        clients[1].rect(),
        Some(WindowRect {
            x: 1290,
            y: 48,
            width: 1260,
            height: 1012
        })
    );
    assert!(clients[2].floating);
}

#[test]
fn malformed_reply_is_an_internal_error() {
    let error =
        parse_clients("{\"not\":\"an array\"}").expect_err("an object is not a clients reply");
    assert_eq!(error.code, ErrorCode::Internal);
    assert!(
        error.message.starts_with("hyprland clients reply"),
        "{}",
        error.message
    );
}

#[test]
fn a_tiled_window_is_placed_by_pid_with_the_floating_dialog_covering_it() {
    let placement = placed(Some(1201), "~").expect("terminal placed");

    assert_eq!(placement.address, "0x5f0c4d0a7d10");
    assert_eq!(
        placement.rect,
        WindowRect {
            x: 10,
            y: 48,
            width: 1260,
            height: 1012
        }
    );
    assert_eq!(
        placement.covering.len(),
        2,
        "the editor and its dialog, not the hidden workspace"
    );
}

#[test]
fn a_shared_pid_is_told_apart_by_title() {
    let dialog = placed(Some(1302), "Save As").expect("dialog placed");

    assert_eq!(dialog.address, "0x5f0c4d0c2f30");
    assert!(
        dialog.covering.is_empty(),
        "tiled windows sit below a floating one"
    );
    assert_eq!(
        placed(Some(1302), "notes.txt")
            .expect("editor placed")
            .covering
            .len(),
        2
    );
}

#[test]
fn unmatched_ambiguous_pidless_and_hidden_windows_are_refused() {
    for (pid, title) in [
        (Some(9999), "~"),
        (Some(1302), "Untitled"),
        (None, "~"),
        (Some(1403), "Docs"),
    ] {
        let error = placed(pid, title).expect_err("must be refused");
        assert_eq!(
            error.code,
            ErrorCode::BackgroundUnavailable,
            "{pid:?} {title}"
        );
        assert!(
            error.message.contains("hyprland-window-unresolved"),
            "{}",
            error.message
        );
    }
}

#[test]
fn detection_follows_the_signature_and_its_socket() {
    let runtime = tempfile::tempdir().expect("runtime dir");
    let dir = || Some(runtime.path().as_os_str().to_owned());

    assert_eq!(detect_from(None, dir()), Detection::NotHyprland);
    assert_eq!(detect_from(Some("".into()), dir()), Detection::NotHyprland);
    assert_eq!(
        detect_from(Some("abc_123".into()), dir()),
        Detection::IpcMissing
    );
    assert_eq!(
        detect_from(Some("../escape".into()), dir()),
        Detection::IpcMissing
    );

    let _server = serve(runtime.path(), "abc_123", Vec::new());
    let socket = runtime.path().join("hypr/abc_123").join(SOCKET_NAME);
    assert_eq!(
        detect_from(Some("abc_123".into()), dir()),
        Detection::Ipc(Hyprland { socket })
    );
}

#[test]
fn placement_reads_clients_and_monitors_over_ipc() {
    let runtime = tempfile::tempdir().expect("runtime dir");
    let server = serve(
        runtime.path(),
        "sig",
        vec![("j/clients", CLIENTS), ("j/monitors", MONITORS)],
    );
    let Detection::Ipc(hyprland) = detect_from(Some("sig".into()), Some(runtime.path().into()))
    else {
        panic!("socket not detected");
    };

    let placement = hyprland
        .placement(&window(Some(1201), "~"))
        .expect("placed over IPC");

    assert_eq!(placement.address, "0x5f0c4d0a7d10");
    assert_eq!(server.join().expect("server"), ["j/clients", "j/monitors"]);
}
