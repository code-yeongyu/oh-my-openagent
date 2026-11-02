//! EWMH window enumeration against the in-memory server.

use x11rb::protocol::xproto::{Atom, AtomEnum, Window};

use super::connection::Placement;
use super::fake::{viewable, FakeServer};
use super::windows::{windows, MAX_WINDOWS};

fn server() -> FakeServer {
    FakeServer::new(1280, 800)
}

fn titled(server: FakeServer, window: Window, title: &str) -> FakeServer {
    let (name, utf8) = (server.intern("_NET_WM_NAME"), server.intern("UTF8_STRING"));
    server.bytes_on(window, name, utf8, title.as_bytes())
}

fn ids(server: &FakeServer) -> Vec<String> {
    windows(server)
        .unwrap()
        .into_iter()
        .map(|window| window.id)
        .collect()
}

#[test]
fn the_stacking_list_is_reported_topmost_first_with_the_active_window_focused() {
    let server = server()
        .root_words("_NET_CLIENT_LIST_STACKING", AtomEnum::WINDOW, &[10, 11, 12])
        .root_words("_NET_CLIENT_LIST", AtomEnum::WINDOW, &[12, 11, 10])
        .root_words("_NET_ACTIVE_WINDOW", AtomEnum::WINDOW, &[11])
        .window(10, viewable(0, 0, 100, 100))
        .window(11, viewable(10, 10, 100, 100))
        .window(12, viewable(20, 20, 100, 100));

    let result = windows(&server).unwrap();

    let order: Vec<_> = result.iter().map(|w| (w.id.as_str(), w.focused)).collect();
    assert_eq!(order, [("12", false), ("11", true), ("10", false)]);
}

#[test]
fn the_client_list_is_the_fallback_when_no_stacking_order_is_published() {
    let server = server()
        .root_words("_NET_CLIENT_LIST", AtomEnum::WINDOW, &[20, 21])
        .window(20, viewable(0, 0, 50, 50))
        .window(21, viewable(0, 0, 50, 50));

    assert_eq!(ids(&server), ["21", "20"]);
}

#[test]
fn without_any_client_list_there_are_no_windows() {
    assert!(windows(&server()).unwrap().is_empty());
}

#[test]
fn unmapped_hidden_tiny_offscreen_and_vanished_windows_are_skipped() {
    let server = server();
    let hidden = server.intern("_NET_WM_STATE_HIDDEN");
    let unmapped = Placement {
        viewable: false,
        ..viewable(0, 0, 100, 100)
    };
    let server = server
        .root_words(
            "_NET_CLIENT_LIST_STACKING",
            AtomEnum::WINDOW,
            &[1, 2, 3, 4, 5, 6, 7, 8],
        )
        .window(1, viewable(0, 0, 100, 100))
        .window(2, unmapped)
        .window(3, viewable(0, 0, 100, 100))
        .words_on(3, "_NET_WM_STATE", AtomEnum::ATOM.into(), &[hidden])
        .window(4, viewable(0, 0, 15, 100))
        .window(5, viewable(1280, 0, 100, 100))
        .window(6, viewable(-100, -100, 100, 100))
        .window(8, viewable(-50, 790, 100, 100));

    assert_eq!(ids(&server), ["8", "1"]);
}

#[test]
fn a_window_reports_its_utf8_title_class_pid_and_root_geometry() {
    let server = titled(server(), 30, "héllo")
        .root_words("_NET_CLIENT_LIST", AtomEnum::WINDOW, &[30])
        .bytes_on(
            30,
            AtomEnum::WM_CLASS.into(),
            AtomEnum::STRING.into(),
            b"xterm\0XTerm\0",
        )
        .words_on(30, "_NET_WM_PID", AtomEnum::CARDINAL.into(), &[4242])
        .window(30, viewable(40, 50, 640, 480));

    let window = windows(&server).unwrap().remove(0);

    let summary = (
        window.title.as_str(),
        window.app.as_str(),
        window.pid,
        (window.x, window.y, window.width, window.height),
        window.elevated,
    );
    assert_eq!(summary, ("héllo", "XTerm", Some(4242), (40, 50, 640, 480), None));
}

#[test]
fn the_title_falls_back_to_wm_name_when_net_wm_name_is_absent() {
    let wm_name = Atom::from(AtomEnum::WM_NAME);
    let server = server()
        .root_words("_NET_CLIENT_LIST", AtomEnum::WINDOW, &[31])
        .bytes_on(31, wm_name, AtomEnum::STRING.into(), b"legacy title")
        .window(31, viewable(0, 0, 100, 100));

    let window = windows(&server).unwrap().remove(0);

    assert_eq!((window.title.as_str(), window.pid), ("legacy title", None));
}

#[test]
fn enumeration_stops_at_the_window_cap() {
    let many: Vec<Window> = (100..100 + 60).collect();
    let server = many.iter().fold(
        server().root_words("_NET_CLIENT_LIST_STACKING", AtomEnum::WINDOW, &many),
        |server, &id| server.window(id, viewable(0, 0, 100, 100)),
    );

    let result = ids(&server);

    assert_eq!(result.len(), MAX_WINDOWS);
    assert_eq!(result.first().map(String::as_str), Some("159"));
}
