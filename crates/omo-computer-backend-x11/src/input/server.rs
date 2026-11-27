//! The input seam: every X request input, holds and frame verbs make, behind [`InputServer`] so
//! the dispatch, the hold ledger and the scratch-keycode restore are proven against a recording
//! fake (`super::fake`). `super::connection::InputConnection` is the x11rb implementation.

use std::time::Duration;

use omo_computer_core::listing::Rect;

pub use crate::capture::server::XError;
use crate::toolkit::Evidence;

use super::keys::GroupMap;

/// An X window id.
pub type Window = u32;

/// One XTEST `FakeInput`: real input as if from the core devices.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FakeInput {
    Key {
        code: u8,
        press: bool,
    },
    Button {
        detail: u8,
        press: bool,
    },
    /// `XTestFakeMotionEvent` to root coordinates.
    Motion {
        x: i16,
        y: i16,
    },
}

/// One `XSendEvent` to a window (the background route); `state` is the modifier mask.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SentEvent {
    Key {
        code: u8,
        press: bool,
        state: u16,
    },
    Button {
        detail: u8,
        press: bool,
        root: (i16, i16),
        local: (i16, i16),
    },
}

/// A request to the window manager, sent as a client message to the root window.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum WmRequest {
    /// `_NET_MOVERESIZE_WINDOW` to this frame (root coordinates).
    MoveResize(Rect),
    /// `XIconifyWindow`: `WM_CHANGE_STATE` with `IconicState`.
    Iconify,
    /// `_NET_ACTIVE_WINDOW`, source indication 2 (a tool acting for the user).
    Activate,
}

/// The window under a root point: its top-level client, the deepest mapped window and the
/// point in that window's coordinates.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Hit {
    pub client: Window,
    pub deepest: Window,
    pub local: (i16, i16),
}

/// The keyboard as the server reports it now.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Keyboard {
    /// Keysyms per keycode, per XKB group, with the keycodes that are not free.
    pub map: GroupMap,
    /// The active XKB group (0-based).
    pub group: usize,
}

/// The X requests input needs. Every method is one round trip or one request.
pub trait InputServer: Send {
    /// XKB `GetMap` (keysyms of every group), `GetState` (the active group), the core map and
    /// the modifier map (which keycodes are free).
    fn keyboard(&self) -> Result<Keyboard, XError>;
    /// `QueryKeymap`: one bit per keycode that is down now.
    fn keys_down(&self) -> Result<[u8; 32], XError>;
    /// The core-map keysyms of `code` (every column), read before a remap to restore them.
    fn keysyms_of(&self, code: u8) -> Result<Vec<u32>, XError>;
    /// `ChangeKeyboardMapping` of the one keycode `code`.
    fn remap(&self, code: u8, keysyms: &[u32]) -> Result<(), XError>;
    fn fake(&self, input: FakeInput) -> Result<(), XError>;
    fn send(&self, window: Window, event: SentEvent) -> Result<(), XError>;
    /// `QueryPointer` on the root: reads only, posts nothing.
    fn pointer(&self) -> Result<(i16, i16), XError>;
    /// The top-level client window that holds the input focus.
    fn focus(&self) -> Result<Window, XError>;
    fn hit(&self, x: i16, y: i16) -> Result<Option<Hit>, XError>;
    /// What the window's client process shows (`WM_CLASS`, `/proc` maps, children, exe);
    /// `None` when the client is not a readable local process.
    fn evidence(&self, window: Window) -> Option<Evidence>;
    fn wm_request(&self, window: Window, request: WmRequest) -> Result<(), XError>;
    /// The window's frame in root coordinates, read now.
    fn frame(&self, window: Window) -> Result<Rect, XError>;
    /// The frame of the next `ConfigureNotify` of `window` within `wait`, translated to root
    /// coordinates; `None` when none arrived.
    fn configured(&self, window: Window, wait: Duration) -> Result<Option<Rect>, XError>;
    fn flush(&self) -> Result<(), XError>;
}

impl InputServer for Box<dyn InputServer> {
    fn keyboard(&self) -> Result<Keyboard, XError> {
        (**self).keyboard()
    }
    fn keys_down(&self) -> Result<[u8; 32], XError> {
        (**self).keys_down()
    }
    fn keysyms_of(&self, code: u8) -> Result<Vec<u32>, XError> {
        (**self).keysyms_of(code)
    }
    fn remap(&self, code: u8, keysyms: &[u32]) -> Result<(), XError> {
        (**self).remap(code, keysyms)
    }
    fn fake(&self, input: FakeInput) -> Result<(), XError> {
        (**self).fake(input)
    }
    fn send(&self, window: Window, event: SentEvent) -> Result<(), XError> {
        (**self).send(window, event)
    }
    fn pointer(&self) -> Result<(i16, i16), XError> {
        (**self).pointer()
    }
    fn focus(&self) -> Result<Window, XError> {
        (**self).focus()
    }
    fn hit(&self, x: i16, y: i16) -> Result<Option<Hit>, XError> {
        (**self).hit(x, y)
    }
    fn evidence(&self, window: Window) -> Option<Evidence> {
        (**self).evidence(window)
    }
    fn wm_request(&self, window: Window, request: WmRequest) -> Result<(), XError> {
        (**self).wm_request(window, request)
    }
    fn frame(&self, window: Window) -> Result<Rect, XError> {
        (**self).frame(window)
    }
    fn configured(&self, window: Window, wait: Duration) -> Result<Option<Rect>, XError> {
        (**self).configured(window, wait)
    }
    fn flush(&self) -> Result<(), XError> {
        (**self).flush()
    }
}

/// Whether bit `code` of a `QueryKeymap` reply is set.
#[must_use]
pub fn is_down(bits: &[u8; 32], code: u8) -> bool {
    bits[usize::from(code / 8)] & (1 << (code % 8)) != 0
}
