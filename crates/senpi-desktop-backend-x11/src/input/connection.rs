//! `X11InputConnection`: the x11rb `InputServer`, on its own connection
//! (the capture connection is left untouched), gated on XTEST 2.2.

use senpi_desktop_core::error::{CoreResult, DesktopError};
use x11rb::connection::Connection;
use x11rb::protocol::xproto::{
    AtomEnum, ClientMessageData, ClientMessageEvent, ConnectionExt as _, EventMask, InputFocus,
    Window, BUTTON_PRESS_EVENT, BUTTON_RELEASE_EVENT, CLIENT_MESSAGE_EVENT, KEY_PRESS_EVENT,
    KEY_RELEASE_EVENT, MOTION_NOTIFY_EVENT,
};
use x11rb::protocol::xtest::ConnectionExt as _;
use x11rb::rust_connection::RustConnection;
use x11rb::CURRENT_TIME;

use super::keys::Keymap;
use super::server::{FakeInput, InputServer, SentEvent};

/// Bounds the descendant walk of `target_at`; real widget trees are far shallower.
const MAX_WINDOW_DEPTH: usize = 32;

pub struct X11InputConnection {
    conn: RustConnection,
    root: Window,
    active_atom: u32,
}

impl X11InputConnection {
    /// Connects through `DISPLAY`, requires XTEST 2.2, and reads the keymap.
    ///
    /// # Errors
    /// `InputFailed` when the server is unreachable or lacks XTEST.
    pub fn connect() -> CoreResult<Self> {
        let (conn, screen) = x11rb::connect(None).map_err(failed)?;
        let root = conn
            .setup()
            .roots
            .get(screen)
            .ok_or_else(|| DesktopError::input_failed("X11 setup reported no default screen"))?
            .root;
        conn.xtest_get_version(2, 2)
            .map_err(failed)?
            .reply()
            .map_err(|error| {
                DesktopError::input_failed(format!("XTEST extension is unavailable: {error}"))
            })?;
        let active_atom = conn
            .intern_atom(false, b"_NET_ACTIVE_WINDOW")
            .map_err(failed)?
            .reply()
            .map_err(failed)?
            .atom;
        Ok(Self {
            conn,
            root,
            active_atom,
        })
    }
}

impl InputServer for X11InputConnection {
    fn root(&self) -> Window {
        self.root
    }

    fn keymap(&self) -> CoreResult<Keymap> {
        let (min_keycode, max_keycode) = (self.conn.setup().min_keycode, self.conn.setup().max_keycode);
        let count = max_keycode.saturating_sub(min_keycode).saturating_add(1);
        let mapping = self
            .conn
            .get_keyboard_mapping(min_keycode, count)
            .map_err(failed)?
            .reply()
            .map_err(failed)?;
        Ok(Keymap {
            min_keycode,
            keysyms_per_keycode: mapping.keysyms_per_keycode,
            keysyms: mapping.keysyms,
        })
    }

    fn fake(&self, input: FakeInput) -> CoreResult<()> {
        let (kind, detail, x, y) = match input {
            FakeInput::Key { code, press } => (pick(press, KEY_PRESS_EVENT, KEY_RELEASE_EVENT), code, 0, 0),
            FakeInput::Button { detail, press } => (
                pick(press, BUTTON_PRESS_EVENT, BUTTON_RELEASE_EVENT),
                detail,
                0,
                0,
            ),
            FakeInput::Motion { x, y } => (MOTION_NOTIFY_EVENT, 0, x, y),
        };
        self.conn
            .xtest_fake_input(kind, detail, CURRENT_TIME, self.root, x, y, 0)
            .map_err(failed)?
            .check()
            .map_err(failed)
    }

    fn send(&self, window: Window, event: SentEvent) -> CoreResult<()> {
        super::connection_events::send(&self.conn, self.root, window, event)
    }

    fn translate(&self, window: Window, x: i16, y: i16) -> CoreResult<(i16, i16)> {
        let reply = self
            .conn
            .translate_coordinates(self.root, window, x, y)
            .map_err(failed)?
            .reply()
            .map_err(failed)?;
        Ok((reply.dst_x, reply.dst_y))
    }

    fn target_at(&self, window: Window, x: i16, y: i16) -> CoreResult<Window> {
        let mut current = window;
        for _ in 0..MAX_WINDOW_DEPTH {
            let reply = self
                .conn
                .translate_coordinates(self.root, current, x, y)
                .map_err(failed)?
                .reply()
                .map_err(failed)?;
            if reply.child == x11rb::NONE {
                break;
            }
            current = reply.child;
        }
        Ok(current)
    }

    fn pointer(&self) -> CoreResult<(i16, i16)> {
        let reply = self
            .conn
            .query_pointer(self.root)
            .map_err(failed)?
            .reply()
            .map_err(failed)?;
        Ok((reply.root_x, reply.root_y))
    }

    fn warp(&self, x: i16, y: i16) -> CoreResult<()> {
        self.conn
            .warp_pointer(x11rb::NONE, self.root, 0, 0, 0, 0, x, y)
            .map_err(failed)?
            .check()
            .map_err(failed)?;
        self.flush()
    }

    fn pointer_within(&self, window: Window) -> CoreResult<bool> {
        super::connection_pointer::within(&self.conn, self.root, window)
    }

    fn pointer_held(&self) -> CoreResult<bool> {
        super::connection_pointer::held(&self.conn, self.root)
    }

    fn active_window(&self) -> Option<Window> {
        self.conn
            .get_property(false, self.root, self.active_atom, AtomEnum::WINDOW, 0, 1)
            .ok()?
            .reply()
            .ok()?
            .value32()?
            .next()
    }

    fn activate(&self, window: Window) -> CoreResult<()> {
        // Source indication 2 = a pager/tool acting for the user (EWMH).
        let event = ClientMessageEvent {
            response_type: CLIENT_MESSAGE_EVENT,
            format: 32,
            sequence: 0,
            window,
            type_: self.active_atom,
            data: ClientMessageData::from([2, CURRENT_TIME, 0, 0, 0]),
        };
        let mask = EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY;
        self.conn
            .send_event(false, self.root, mask, event)
            .map_err(failed)?
            .check()
            .map_err(failed)?;
        self.flush()
    }

    fn focus_window(&self) -> CoreResult<Window> {
        self.conn
            .get_input_focus()
            .map_err(failed)?
            .reply()
            .map(|reply| reply.focus)
            .map_err(failed)
    }

    fn set_focus(&self, window: Window) -> CoreResult<()> {
        self.conn
            .set_input_focus(InputFocus::PARENT, window, CURRENT_TIME)
            .map_err(failed)?
            .check()
            .map_err(failed)?;
        self.flush()
    }

    fn parent(&self, window: Window) -> CoreResult<Option<Window>> {
        let parent = self
            .conn
            .query_tree(window)
            .map_err(failed)?
            .reply()
            .map_err(failed)?
            .parent;
        Ok((parent != 0 && parent != window).then_some(parent))
    }

    fn wm_class(&self, window: Window) -> Option<Vec<u8>> {
        let reply = self
            .conn
            .get_property(false, window, AtomEnum::WM_CLASS, AtomEnum::STRING, 0, 1024)
            .ok()?
            .reply()
            .ok()?;
        (!reply.value.is_empty()).then_some(reply.value)
    }

    fn flush(&self) -> CoreResult<()> {
        self.conn.flush().map_err(failed)
    }
}

pub(super) fn pick<T: Copy>(press: bool, down: T, up: T) -> T {
    if press {
        down
    } else {
        up
    }
}

pub(super) fn failed(error: impl std::fmt::Display) -> DesktopError {
    DesktopError::input_failed(format!("X11 input request failed: {error}"))
}
