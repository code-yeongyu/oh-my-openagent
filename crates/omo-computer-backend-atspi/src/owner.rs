//! Which native window an AT-SPI frame is: joined by pid, exact title and geometry, failing
//! closed to unknown or ambiguous, never a topmost guess.

use crate::bus::Extents;

/// One window as the host backend lists it (an X11 XID with its `_NET_WM_PID`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativeWindow {
    pub id: String,
    pub pid: Option<u32>,
    pub app: String,
    pub title: String,
    pub bounds: Extents,
}

/// The host's window list, read when a native window id is targeted.
pub trait WindowSource: Send {
    fn windows(&mut self) -> Vec<NativeWindow>;
}

impl WindowSource for Vec<NativeWindow> {
    fn windows(&mut self) -> Vec<NativeWindow> {
        self.clone()
    }
}
