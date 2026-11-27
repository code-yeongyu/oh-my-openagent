//! `InputConnection`: the x11rb [`InputServer`], on its own connection (the capture's is left
//! untouched), gated on XTEST 2.2 and XKB 1.0.

use std::time::Duration;

use omo_computer_core::listing::Rect;
use x11rb::connection::Connection;
use x11rb::protocol::xkb::ConnectionExt as _;
use x11rb::protocol::xproto::{
    ConnectionExt as _, BUTTON_PRESS_EVENT, BUTTON_RELEASE_EVENT, KEY_PRESS_EVENT,
    KEY_RELEASE_EVENT, MOTION_NOTIFY_EVENT,
};
use x11rb::protocol::xtest::ConnectionExt as _;
use x11rb::rust_connection::RustConnection;
use x11rb::CURRENT_TIME;

use super::server::{FakeInput, Hit, InputServer, Keyboard, SentEvent, Window, WmRequest, XError};
use crate::toolkit::Evidence;

/// Bounds the descendant walk of `hit`; real widget trees are far shallower.
const MAX_DEPTH: usize = 32;

pub(super) fn x(error: impl std::fmt::Display) -> XError {
    XError(error.to_string())
}

pub struct InputConnection {
    pub(super) conn: RustConnection,
    pub(super) root: Window,
    pub(super) atoms: super::connection_wm::Atoms,
}

impl InputConnection {
    /// Connects to `display`, requiring XTEST 2.2 and XKB 1.0.
    ///
    /// # Errors
    /// The display is unreachable or lacks either extension.
    pub fn connect(display: &str) -> Result<Self, XError> {
        let (conn, screen) = x11rb::connect(Some(display)).map_err(x)?;
        let root = conn
            .setup()
            .roots
            .get(screen)
            .ok_or_else(|| XError("no default screen".into()))?
            .root;
        conn.xtest_get_version(2, 2)
            .map_err(x)?
            .reply()
            .map_err(x)?;
        let xkb = conn
            .xkb_use_extension(1, 0)
            .map_err(x)?
            .reply()
            .map_err(x)?;
        if !xkb.supported {
            return Err(XError("XKB 1.0 is unavailable".into()));
        }
        let atoms = super::connection_wm::Atoms::intern(&conn)?;
        Ok(Self { conn, root, atoms })
    }

    pub(super) fn core_rows(&self, first: u8, count: u8) -> Result<(u8, Vec<u32>), XError> {
        let mapping = self
            .conn
            .get_keyboard_mapping(first, count)
            .map_err(x)?
            .reply()
            .map_err(x)?;
        Ok((mapping.keysyms_per_keycode, mapping.keysyms))
    }
}

impl InputServer for InputConnection {
    fn keyboard(&self) -> Result<Keyboard, XError> {
        self.read_keyboard()
    }

    fn keys_down(&self) -> Result<[u8; 32], XError> {
        Ok(self
            .conn
            .query_keymap()
            .map_err(x)?
            .reply()
            .map_err(x)?
            .keys)
    }

    fn keysyms_of(&self, code: u8) -> Result<Vec<u32>, XError> {
        Ok(self.core_rows(code, 1)?.1)
    }

    fn remap(&self, code: u8, keysyms: &[u32]) -> Result<(), XError> {
        let width = u8::try_from(keysyms.len().max(1)).map_err(x)?;
        let padded: Vec<u32> = if keysyms.is_empty() {
            vec![0]
        } else {
            keysyms.to_vec()
        };
        self.conn
            .change_keyboard_mapping(1, code, width, &padded)
            .map_err(x)?
            .check()
            .map_err(x)
    }

    fn fake(&self, input: FakeInput) -> Result<(), XError> {
        let (kind, detail, x_root, y_root) = match input {
            FakeInput::Key { code, press } => (
                if press {
                    KEY_PRESS_EVENT
                } else {
                    KEY_RELEASE_EVENT
                },
                code,
                0,
                0,
            ),
            FakeInput::Button { detail, press } => (
                if press {
                    BUTTON_PRESS_EVENT
                } else {
                    BUTTON_RELEASE_EVENT
                },
                detail,
                0,
                0,
            ),
            FakeInput::Motion { x: mx, y: my } => (MOTION_NOTIFY_EVENT, 0, mx, my),
        };
        self.conn
            .xtest_fake_input(kind, detail, CURRENT_TIME, self.root, x_root, y_root, 0)
            .map_err(x)?
            .check()
            .map_err(x)
    }

    fn send(&self, window: Window, event: SentEvent) -> Result<(), XError> {
        self.send_event(window, event)
    }

    fn pointer(&self) -> Result<(i16, i16), XError> {
        let reply = self
            .conn
            .query_pointer(self.root)
            .map_err(x)?
            .reply()
            .map_err(x)?;
        Ok((reply.root_x, reply.root_y))
    }

    fn focus(&self) -> Result<Window, XError> {
        Ok(self
            .conn
            .get_input_focus()
            .map_err(x)?
            .reply()
            .map_err(x)?
            .focus)
    }

    fn hit(&self, px: i16, py: i16) -> Result<Option<Hit>, XError> {
        let (mut current, mut local) = (self.root, (px, py));
        for _ in 0..MAX_DEPTH {
            let reply = self
                .conn
                .translate_coordinates(self.root, current, px, py)
                .map_err(x)?
                .reply()
                .map_err(x)?;
            local = (reply.dst_x, reply.dst_y);
            if reply.child == x11rb::NONE {
                break;
            }
            current = reply.child;
        }
        Ok((current != self.root).then_some(Hit {
            client: current,
            deepest: current,
            local,
        }))
    }

    fn evidence(&self, window: Window) -> Option<Evidence> {
        self.client_evidence(window)
    }

    fn wm_request(&self, window: Window, request: WmRequest) -> Result<(), XError> {
        self.request(window, request)
    }

    fn frame(&self, window: Window) -> Result<Rect, XError> {
        self.root_frame(window)
    }

    fn configured(&self, window: Window, wait: Duration) -> Result<Option<Rect>, XError> {
        self.await_configure(window, wait)
    }

    fn flush(&self) -> Result<(), XError> {
        self.conn.flush().map_err(x)
    }
}
