//! One XI2 connection lifetime of the kill switch: a dedicated x11rb
//! connection selects `XI_RawKeyPress`/`XI_RawKeyRelease` on the root for
//! every master device (raw events reach it regardless of focus or grabs),
//! and a heartbeat round trip every 500 ms proves the connection answers.

use std::thread;

use senpi_desktop_safety::StopPathError;
use x11rb::connection::Connection;
use x11rb::errors::ConnectionError;
use x11rb::protocol::xinput::{self, ConnectionExt as _, Device, XIEventMask};
use x11rb::protocol::xproto::{
    AtomEnum, ClientMessageEvent, ConnectionExt as _, CreateWindowAux, EventMask, Window, WindowClass,
};
use x11rb::protocol::Event;
use x11rb::rust_connection::RustConnection;

use super::chord::{Hotkey, Pressed};
use super::Shared;
use crate::input::Keymap;

pub const CONNECTION_FAILED: &str = "x11-connection-failed";
pub const XINPUT2_UNAVAILABLE: &str = "xinput2-unavailable";

/// How one connection lifetime ended.
#[derive(Debug, PartialEq, Eq)]
pub enum Run {
    /// The connection or the XI2 selection never came up.
    OpenFailed,
    /// It was live, then the connection broke.
    Died,
    /// The owner dropped the listener.
    Shutdown,
}

struct Session {
    conn: RustConnection,
    /// An `InputOnly` window of this connection: a `ClientMessage` sent to it
    /// with an empty mask reaches only this client, which wakes the event
    /// thread at shutdown.
    wake: Window,
    keymap: Keymap,
}

/// The connection broke while the session was being set up.
fn lost<E>(_error: E) -> StopPathError {
    unavailable(CONNECTION_FAILED)
}

fn unavailable(reason: &str) -> StopPathError {
    StopPathError::Unavailable {
        reason: reason.to_owned(),
    }
}

impl Session {
    fn open(hotkey: &Hotkey) -> Result<Self, StopPathError> {
        let (conn, screen) = x11rb::connect(None).map_err(|_| unavailable(CONNECTION_FAILED))?;
        let root = conn
            .setup()
            .roots
            .get(screen)
            .ok_or_else(|| unavailable(CONNECTION_FAILED))?
            .root;
        let xi2 = || unavailable(XINPUT2_UNAVAILABLE);
        let version = conn
            .xinput_xi_query_version(2, 2)
            .map_err(|_| xi2())?
            .reply()
            .map_err(|_| xi2())?;
        if version.major_version < 2 {
            return Err(xi2());
        }
        let mask = xinput::EventMask {
            deviceid: Device::ALL_MASTER.into(),
            mask: vec![XIEventMask::RAW_KEY_PRESS | XIEventMask::RAW_KEY_RELEASE],
        };
        conn.xinput_xi_select_events(root, &[mask])
            .map_err(|_| xi2())?
            .check()
            .map_err(|_| xi2())?;
        let (min_keycode, max_keycode) = (conn.setup().min_keycode, conn.setup().max_keycode);
        let count = max_keycode.saturating_sub(min_keycode).saturating_add(1);
        let mapping = conn
            .get_keyboard_mapping(min_keycode, count)
            .map_err(lost)?
            .reply()
            .map_err(lost)?;
        let keymap = Keymap {
            min_keycode,
            keysyms_per_keycode: mapping.keysyms_per_keycode,
            keysyms: mapping.keysyms,
        };
        hotkey.resolve(&keymap)?;
        let wake = conn.generate_id().map_err(lost)?;
        let aux = CreateWindowAux::new();
        conn.create_window(0, wake, root, 0, 0, 1, 1, 0, WindowClass::INPUT_ONLY, 0, &aux)
            .map_err(lost)?
            .check()
            .map_err(lost)?;
        Ok(Self { conn, wake, keymap })
    }

    /// Reads raw key events until the connection breaks or the wake message
    /// arrives.
    fn listen(&self, shared: &Shared) {
        let mut pressed = Pressed::default();
        while let Ok(event) = self.conn.wait_for_event() {
            match event {
                Event::XinputRawKeyPress(raw) => {
                    // Resolved per press, so a chord replaced by a later
                    // `start()` applies to the running connection.
                    let chord = shared.hotkey.lock().resolve(&self.keymap);
                    let code = u8::try_from(raw.detail);
                    if let (Ok(code), Ok(chord)) = (code, chord) {
                        if pressed.press(code, &chord) {
                            shared.chord_pressed();
                        }
                    }
                }
                Event::XinputRawKeyRelease(raw) => {
                    if let Ok(code) = u8::try_from(raw.detail) {
                        pressed.release(code);
                    }
                }
                Event::ClientMessage(message) if message.window == self.wake => return,
                _ => {}
            }
        }
    }

    /// One heartbeat: a round trip the server must answer.
    fn answers(&self) -> bool {
        self.conn
            .get_input_focus()
            .is_ok_and(|cookie| cookie.reply().is_ok())
    }

    /// Wakes `listen` with a message only this client receives.
    fn wake(&self) -> Result<(), ConnectionError> {
        let message = ClientMessageEvent::new(32, self.wake, AtomEnum::NONE, [0_u32; 5]);
        self.conn
            .send_event(false, self.wake, EventMask::NO_EVENT, message)?;
        self.conn.flush()
    }
}

/// Runs one connection lifetime; the `Global` path is live only while the
/// connection answers and the event thread runs.
pub fn run(shared: &Shared, hotkey: &Hotkey) -> Run {
    let session = match Session::open(hotkey) {
        Ok(session) => session,
        Err(error) => {
            shared.open_failed(error.reason());
            return Run::OpenFailed;
        }
    };
    shared.set_live(true);
    let exit = thread::scope(|scope| {
        let events = scope.spawn(|| session.listen(shared));
        let exit = loop {
            if shared.wait_shutdown(super::HEARTBEAT) {
                break Run::Shutdown;
            }
            if events.is_finished() || !session.answers() {
                break Run::Died;
            }
            shared.heartbeat();
        };
        if !events.is_finished() {
            match session.wake() {
                Ok(()) => {}
                // The connection broke: `listen` returns on that same error.
                Err(_broken) => {}
            }
        }
        exit
    });
    shared.set_live(false);
    exit
}
