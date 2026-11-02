//! Desktop input against the fake EIS server: what arrives on the wire for
//! the `fr` and `us-fr` keymaps, and what `release_all` lifts.

use std::os::unix::net::UnixListener;

use senpi_desktop_core::backend::{Backend, DeliveryMode, Modifiers, MouseButton, PointerEvent};
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::types::Target;

use super::tests::{backend_without_services, FR};
use super::WaylandBackend;
use crate::test_support::fake_eis::{DeviceTopology, EisConfig, FakeEis, Recorded};
use crate::test_support::{env_lock, LibeiSocketEnv};

const US_FR: &str = include_str!("../../testdata/us-fr.xkb");
const BTN_LEFT: u32 = 0x110;

/// Keysym names read off the fixture keymaps by hand (`key <AC06>` is `h`
/// in both, `<AE02>` is `eacute` in fr, `<AD03>` is `e` in us), so the
/// expectation is independent of the resolver under test.
fn keysym(layout: &str, keycode: u32) -> &'static str {
    match (layout, keycode) {
        (_, 35) => "h",
        ("fr", 3) => "eacute",
        ("us", 18) => "e",
        (_, 38) => "l",
        (_, 24) => "o",
        _ => "?",
    }
}

/// The keysyms of every key press, in order, each followed by its release.
fn typed_keysyms(layout: &str, events: &[Recorded]) -> Vec<&'static str> {
    let presses: Vec<u32> = events
        .iter()
        .filter_map(|event| match event {
            Recorded::Key {
                keycode,
                pressed: true,
            } => Some(*keycode),
            _ => None,
        })
        .collect();
    let released_in_order = events.chunks(2).all(|pair| {
        matches!(pair, [Recorded::Key { keycode: down, pressed: true }, Recorded::Key { keycode: up, pressed: false }] if down == up)
    });
    assert!(
        released_in_order,
        "every key must be released before the next press: {events:?}"
    );
    presses
        .into_iter()
        .map(|keycode| keysym(layout, keycode))
        .collect()
}

pub(super) struct Session {
    pub(super) eis: FakeEis,
    pub(super) backend: WaylandBackend,
    _socket: LibeiSocketEnv,
    _dir: tempfile::TempDir,
}

pub(super) fn session(config: EisConfig) -> Session {
    session_with_topology(config, DeviceTopology::BothSameSeat)
}

pub(super) fn session_with_topology(config: EisConfig, topology: DeviceTopology) -> Session {
    let dir = tempfile::Builder::new()
        .prefix("senpi-libei-")
        .tempdir()
        .expect("socket dir");
    let socket = dir.path().join("eis-0");
    let eis =
        FakeEis::listen_with_topology(UnixListener::bind(&socket).expect("bind"), config, topology);
    Session {
        eis,
        backend: backend_without_services(),
        _socket: LibeiSocketEnv::set(Some(&socket)),
        _dir: dir,
    }
}

fn type_text(session: &mut Session, text: &str) -> Result<(), ErrorCode> {
    session
        .backend
        .type_text(&Target::Desktop, text, DeliveryMode::Background)
        .map_err(|error| error.code)
}

#[test]
fn hello_with_an_accent_arrives_as_french_keysyms_on_the_fr_keymap() {
    let _env = env_lock();
    let mut session = session(EisConfig {
        keymap: FR,
        group: 0,
    });

    let typed = type_text(&mut session, "héllo");

    assert_eq!(typed, Ok(()));
    let log = session.eis.wait_for(|log| log.bursts >= 1);
    assert_eq!(
        typed_keysyms("fr", &log.events),
        ["h", "eacute", "l", "l", "o"]
    );
}

#[test]
fn hello_with_an_accent_arrives_through_the_active_french_group_of_us_fr() {
    let _env = env_lock();
    let mut session = session(EisConfig {
        keymap: US_FR,
        group: 1,
    });

    let typed = type_text(&mut session, "héllo");

    assert_eq!(typed, Ok(()));
    let log = session.eis.wait_for(|log| log.bursts >= 1);
    assert_eq!(
        typed_keysyms("fr", &log.events),
        ["h", "eacute", "l", "l", "o"]
    );
}

#[test]
fn the_us_group_refuses_an_accent_it_cannot_type_and_sends_nothing() {
    let _env = env_lock();
    let mut session = session(EisConfig {
        keymap: US_FR,
        group: 0,
    });

    let refused = type_text(&mut session, "héllo");
    let typed = type_text(&mut session, "hello");

    assert_eq!(refused, Err(ErrorCode::InputFailed));
    assert_eq!(typed, Ok(()));
    let log = session.eis.wait_for(|log| log.bursts >= 1);
    assert_eq!(log.bursts, 1, "the refused text must not start a burst");
    assert_eq!(typed_keysyms("us", &log.events), ["h", "e", "l", "l", "o"]);
}

#[test]
fn a_click_moves_then_presses_and_releases_the_button() {
    let _env = env_lock();
    let mut session = session(EisConfig {
        keymap: FR,
        group: 0,
    });
    let click = PointerEvent::Click {
        x: 100.0,
        y: 200.0,
        button: MouseButton::Left,
        count: 1,
        modifiers: Modifiers::default(),
    };

    let clicked = session.backend.pointer(
        &Target::Desktop,
        click,
        &FrameGeometry::for_displays(&[]),
        DeliveryMode::Background,
    );

    assert_eq!(clicked, Ok(()));
    let log = session.eis.wait_for(|log| log.bursts >= 1);
    assert_eq!(
        log.events,
        [
            Recorded::Motion { x: 100.0, y: 200.0 },
            Recorded::Button {
                code: BTN_LEFT,
                pressed: true
            },
            Recorded::Button {
                code: BTN_LEFT,
                pressed: false
            },
        ]
    );
}

#[test]
fn invalid_later_drag_point_sends_no_input() {
    // Given: the second drag point is outside the device region
    let _env = env_lock();
    let mut session = session(EisConfig {
        keymap: FR,
        group: 0,
    });
    let drag = PointerEvent::Drag {
        path: vec![(10.0, 10.0), (5000.0, 5000.0)],
        button: MouseButton::Left,
        modifiers: Modifiers::default(),
    };
    let dragged = session
        .backend
        .pointer(
            &Target::Desktop,
            drag,
            &FrameGeometry::for_displays(&[]),
            DeliveryMode::Background,
        )
        .map_err(|error| error.code);
    assert_eq!(dragged, Err(ErrorCode::InputFailed));

    // When: cleanup runs after the refusal
    let released = session.backend.release_all();

    // Then: preflight refused before motion, modifier, or button input
    assert_eq!(released, Ok(()));
    let log = session.eis.wait_for(|log| log.connected);
    assert!(log.events.is_empty(), "{:?}", log.events);
    assert_eq!(log.bursts, 0);
}
