//! Window frame verbs with read-back (design row M11): `setFrame` writes `AXPosition` and
//! `AXSize` and answers the frame read back (the session judges it within 1 px per edge); a
//! full-screen window or one whose position cannot be set is immovable, with nothing written.
//! `setFrame` and `minimize` need no lease; `restore` does, because un-minimizing activates
//! the app, and answers `ControlRequired{lease_missing}` without it. A Space is never switched
//! to reach a window.

use omo_computer_core::backend::{BackendResult, Refusal};
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::listing::Rect;
use omo_computer_core::window_frame::{FrameApplied, EDGE_TOLERANCE};

use super::seam::{FoundWindow, WindowOs};

/// The frame verbs over one window seam.
pub struct MacWindows<O> {
    os: O,
    lease: bool,
}

fn number(window: &str) -> BackendResult<u32> {
    window
        .parse()
        .map_err(|_| Refusal::bare(EngineCode::WindowNotFound))
}

fn differs(a: f64, b: f64) -> bool {
    (a - b).abs() > EDGE_TOLERANCE
}

const UNAVAILABLE: Refusal =
    Refusal::new(EngineCode::InvalidTarget, Reason::WindowFrameUnavailable);

impl<O: WindowOs> MacWindows<O> {
    pub const fn new(os: O) -> Self {
        Self { os, lease: false }
    }

    pub const fn os(&self) -> &O {
        &self.os
    }

    pub const fn os_mut(&mut self) -> &mut O {
        &mut self.os
    }

    /// Whether the session holds the foreground lease now.
    pub const fn set_lease(&mut self, held: bool) {
        self.lease = held;
    }

    /// Whether the window can be placed at all; `Some(false)` for full screen or a position
    /// AX will not set.
    pub fn frame_settable(&mut self, window: &str) -> Option<bool> {
        let n = number(window).ok()?;
        if self.os.full_screen(n) == Some(true) {
            return Some(false);
        }
        self.os.position_settable(n)
    }

    /// `window.setFrame`: writes the axes that differ and answers the frame read back.
    ///
    /// # Errors
    /// `WindowNotFound` for an unknown window, `InvalidTarget{window_frame_unavailable}` when
    /// it has no frame to read back.
    pub fn set_frame(&mut self, window: &str, frame: Rect) -> BackendResult<FrameApplied> {
        let n = number(window)?;
        let before = self
            .os
            .frame(n)
            .ok_or(Refusal::bare(EngineCode::WindowNotFound))?;
        if self.frame_settable(window) == Some(false) {
            return Ok(FrameApplied {
                frame: before,
                immovable: true,
            });
        }
        let moves = differs(before.x, frame.x) || differs(before.y, frame.y);
        let sizes = differs(before.width, frame.width) || differs(before.height, frame.height);
        if moves {
            self.os.set_position(n, frame.x, frame.y);
        }
        if sizes {
            self.os.set_size(n, frame.width, frame.height);
            // A resize can push the origin; place it again.
            if moves {
                self.os.set_position(n, frame.x, frame.y);
            }
        }
        let read_back = self.os.frame(n).ok_or(UNAVAILABLE)?;
        Ok(FrameApplied {
            frame: read_back,
            immovable: false,
        })
    }

    /// `window.minimize` (`true`) or `window.restore` (`false`), confirmed by reading
    /// `AXMinimized` back.
    ///
    /// # Errors
    /// `ControlRequired{lease_missing}` for a restore without the lease (nothing sent),
    /// `InvalidTarget{window_frame_unavailable}` when the write or its read-back failed.
    pub fn set_minimized(&mut self, window: &str, minimize: bool) -> BackendResult<()> {
        let n = number(window)?;
        if !minimize && !self.lease {
            return Err(Refusal::new(
                EngineCode::ControlRequired,
                Reason::LeaseMissing,
            ));
        }
        if !self.os.set_minimized(n, minimize) || self.os.minimized(n) != Some(minimize) {
            return Err(UNAVAILABLE);
        }
        Ok(())
    }

    /// The windows of `pid` the AX tree shows, sheets, popovers and other Spaces' windows
    /// included; nothing is activated and no Space is switched.
    pub fn query(&mut self, pid: u32) -> Vec<FoundWindow> {
        super::query::query(&mut self.os, pid)
    }
}
