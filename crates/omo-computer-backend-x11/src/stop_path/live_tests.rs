//! Row 50's live legs (verify-3): they need a real X server, so they are `#[ignore]` and run
//! under `xvfb-run -a cargo test -p omo-computer-backend-x11 --locked --lib -- --ignored`.
//! Every wait re-checks a server-side fact; the 5 s deadline is a hang guard, never a latency
//! assertion.

use std::time::{Duration, Instant};

use omo_computer_core::backend::{Backend, CaptureOptions, EpochSource, StopListener, Target};
use x11rb::connection::Connection;
use x11rb::protocol::xproto::{ConnectionExt as _, ImageFormat, KEY_PRESS_EVENT, KEY_RELEASE_EVENT};
use x11rb::protocol::xtest::ConnectionExt as _;
use x11rb::wrapper::ConnectionExt as _;

use super::{
    arm, Armed, LeaseEndSignal, Live, RawKeyServer, X11StopListener, Xi2Server, DEFAULT_STOP_CHORD,
};
use crate::capture::X11Connection;
use crate::backend::X11Backend;
use crate::epoch::X11EpochSource;
use crate::overlay::OVERLAY_RGB;

const HANG_GUARD: Duration = Duration::from_secs(5);

/// `XK_Control_L`, `XK_Alt_L`, `XK_Shift_L`, `XK_Escape`: the default chord, modifiers first.
const CHORD_KEYSYMS: [u32; 4] = [0xffe3, 0xffe9, 0xffe1, 0xff1b];

fn display() -> String {
    std::env::var("DISPLAY").expect("the live legs run under xvfb-run, which sets DISPLAY")
}

fn armed_listener(display: &str) -> X11StopListener {
    let server = Xi2Server::connect(display).expect("an XI2 connection to the live server");
    match arm(
        Box::new(server),
        DEFAULT_STOP_CHORD,
        LeaseEndSignal::default(),
    ) {
        Ok(Armed::Live(listener)) => listener,
        Ok(Armed::Deaf(reason)) => panic!("the listener is deaf on a live server: {reason:?}"),
        Err(_) => panic!("the connection broke while arming"),
    }
}

fn xtest_chord(display: &str) -> usize {
    let mut probe = Xi2Server::connect(display).expect("a second XI2 connection for the keymap");
    let keymap = probe.keymap().expect("the live keymap");
    let codes: Vec<u8> = CHORD_KEYSYMS
        .iter()
        .map(|keysym| {
            *keymap
                .codes(*keysym)
                .first()
                .expect("the keymap maps every chord key")
        })
        .collect();
    let (conn, screen) = x11rb::connect(Some(display)).expect("an injector connection");
    let root = conn.setup().roots[screen].root;
    for code in &codes {
        conn.xtest_fake_input(KEY_PRESS_EVENT, *code, 0, root, 0, 0, 0)
            .expect("XTEST key press");
    }
    for code in codes.iter().rev() {
        conn.xtest_fake_input(KEY_RELEASE_EVENT, *code, 0, root, 0, 0, 0)
            .expect("XTEST key release");
    }
    conn.sync().expect("the injector round trip");
    codes.len()
}

#[test]
#[ignore = "needs a live X server: run under xvfb-run"]
fn xi2_listener_arms_live_and_hears_nothing_on_an_idle_server() {
    let display = display();
    let mut listener = armed_listener(&display);
    assert_eq!(listener.poll_stop().ok(), Some(false));
    let mut live = Live::for_display(Some(&display));
    assert_eq!(live.set_chord(Some(DEFAULT_STOP_CHORD)), Ok(()), "the consent view's chord");
    let mut armed = live
        .stop_listener()
        .expect("the backend arms its own listener");
    assert_eq!(
        armed.poll_stop().ok(),
        Some(false),
        "a deaf listener would refuse here"
    );
}

#[test]
#[ignore = "needs a live X server: run under xvfb-run"]
fn xtest_chord_never_stops() {
    let display = display();
    let mut listener = armed_listener(&display);
    let presses = xtest_chord(&display);
    let deadline = Instant::now() + HANG_GUARD;
    let mut stopped = false;
    while listener.xtest_ignored() < presses as u64 {
        stopped |= listener.poll_stop().expect("the live listener answers");
        assert!(
            Instant::now() < deadline,
            "hang guard: the XTEST presses never arrived as raw events"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
    stopped |= listener.poll_stop().expect("the live listener answers");
    assert!(!stopped, "an XTEST chord latched the stop");
    assert_eq!(listener.xtest_ignored(), presses as u64);
}

#[test]
#[ignore = "needs a live X server: run under xvfb-run"]
fn presence_overlay_shows_and_hides_on_a_live_server() {
    let live = Live::for_display(Some(&display()));
    let mut presence = live
        .presence()
        .expect("the overlay connects to the live server");
    presence.show().expect("the overlay shows");
    presence.hide().expect("the overlay hides");
}

#[test]
#[ignore = "needs a live X server: run under xvfb-run"]
fn randr_epoch_source_reports_no_change_on_an_unchanged_server() {
    let connection = X11Connection::connect(&display()).expect("a capture connection");
    let mut epochs = X11EpochSource::new(connection);
    assert_eq!(epochs.next_change().ok(), Some(None));
}

fn overlay_rgb() -> [u8; 3] {
    let [_, r, g, b] = OVERLAY_RGB.to_be_bytes();
    [r, g, b]
}

fn top_row_shows_overlay(display: &str) -> bool {
    let (conn, screen) = x11rb::connect(Some(display)).expect("an oracle connection");
    let root = &conn.setup().roots[screen];
    assert_eq!(root.root_depth, 24, "run the live legs on a 24-bit screen (xvfb-run -s '-screen 0 1280x800x24')");
    let row = conn
        .get_image(ImageFormat::Z_PIXMAP, root.root, 0, 0, root.width_in_pixels, 1, u32::MAX)
        .expect("XGetImage request")
        .reply()
        .expect("XGetImage reply");
    let [r, g, b] = overlay_rgb();
    row.data.as_chunks::<4>().0.iter().all(|[blue, green, red, _]| *red == r && *green == g && *blue == b)
}

#[test]
#[ignore = "needs a live X server: run under xvfb-run"]
fn overlay_is_on_screen_and_never_in_a_desktop_capture() {
    let display = display();
    let mut backend = X11Backend::from_env(Some(&display), None);
    let mut presence = backend.presence().expect("the overlay connects to the live server");
    presence.show().expect("the overlay shows");
    assert!(top_row_shows_overlay(&display), "the oracle sees the border before the capture");
    let frame = backend
        .capture(&Target::Desktop, &CaptureOptions { cursor: false, crosshair: None, region: None })
        .expect("a desktop capture");
    let pixels = image::load_from_memory(&frame.bytes).expect("the frame decodes").to_rgb8();
    let overlay = overlay_rgb();
    let seen = pixels.pixels().filter(|px| px.0 == overlay).count();
    assert_eq!(seen, 0, "the capture contains overlay-coloured pixels");
    assert!(top_row_shows_overlay(&display), "the border is mapped back after the read");
    presence.hide().expect("the overlay hides");
}
