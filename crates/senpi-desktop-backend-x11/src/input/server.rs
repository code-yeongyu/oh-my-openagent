//! The input seam: the X requests delivery needs, behind `InputServer` so the
//! dispatch, focus guard and held-state logic is unit-tested against a
//! recording fake. `super::connection::X11InputConnection` is the x11rb
//! implementation.

use senpi_desktop_core::error::CoreResult;
use x11rb::protocol::xproto::Window;

use super::keys::Keymap;

/// A root-coordinate point and the same point in the target window.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Spot {
    pub root: (i16, i16),
    pub local: (i16, i16),
}

/// One XTEST `FakeInput`: real input as if from the core devices.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FakeInput {
    Key { code: u8, press: bool },
    Button { detail: u8, press: bool },
    Motion { x: i16, y: i16 },
}

/// One `XSendEvent` to a window; `state` is the event's modifier/button mask.
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
        at: Spot,
        state: u16,
    },
    Motion {
        at: Spot,
        state: u16,
    },
}

pub trait InputServer {
    fn root(&self) -> Window;
    fn keymap(&self) -> &Keymap;
    fn fake(&self, input: FakeInput) -> CoreResult<()>;
    fn send(&self, window: Window, event: SentEvent) -> CoreResult<()>;
    /// Root `(x, y)` in `window`'s coordinates.
    fn translate(&self, window: Window, x: i16, y: i16) -> CoreResult<(i16, i16)>;
    /// The deepest mapped descendant of `window` under root `(x, y)`, or
    /// `window` itself: Xt and most toolkits dispatch a sent pointer event by
    /// its event window, so it must name the widget under the point.
    fn target_at(&self, window: Window, x: i16, y: i16) -> CoreResult<Window>;
    /// The core pointer's root position.
    fn pointer(&self) -> CoreResult<(i16, i16)>;
    fn warp(&self, x: i16, y: i16) -> CoreResult<()>;
    /// `_NET_ACTIVE_WINDOW`: `None` when the window manager does not publish
    /// it (no EWMH manager), `Some(0)` when no window is active.
    fn active_window(&self) -> Option<Window>;
    /// Asks the window manager to activate `window` (EWMH client message).
    fn activate(&self, window: Window) -> CoreResult<()>;
    /// Raw `WM_CLASS` bytes (`instance\0class\0`); `None` when absent.
    fn wm_class(&self, window: Window) -> Option<Vec<u8>>;
    fn flush(&self) -> CoreResult<()>;
}
