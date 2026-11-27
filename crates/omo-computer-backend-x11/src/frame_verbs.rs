//! Row 49: the frame verbs. `window.setFrame` asks the window manager with
//! `_NET_MOVERESIZE_WINDOW` and reads back the frame the `ConfigureNotify` that follows reports,
//! translated to root coordinates (a reparented client's notify is parent-relative); a manager
//! that sends none is read with a fresh geometry query. The session judges the read-back with
//! `omo_computer_core::window_frame::judge`, so a tiling manager that keeps its size answers
//! `partial{kept:[width,height]}` (design row L6). `window.minimize` is `XIconifyWindow`;
//! `window.restore` is `_NET_ACTIVE_WINDOW`, which the session posts only under the lease.

use std::time::Duration;

use omo_computer_core::backend::{BackendResult, Refusal};
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::listing::Rect;
use omo_computer_core::window_frame::FrameApplied;

use crate::input::server::{InputServer, Window, WmRequest};
use crate::input::{failed, X11Input};

/// How long a frame request waits for the window manager's `ConfigureNotify`.
pub const CONFIGURE_WAIT: Duration = Duration::from_millis(500);

fn window_id(window: &str) -> Result<Window, Refusal> {
    window
        .parse()
        .map_err(|_| Refusal::bare(EngineCode::WindowNotFound))
}

impl<S: InputServer> X11Input<S> {
    /// Asks for `frame` and answers the frame read back.
    ///
    /// # Errors
    /// `WindowNotFound` for an id that is not an X window, `InputFailed` when a request failed.
    pub fn set_frame(&mut self, window: &str, frame: Rect) -> BackendResult<FrameApplied> {
        let id = window_id(window)?;
        self.server
            .wm_request(id, WmRequest::MoveResize(frame))
            .map_err(|error| failed(&error))?;
        self.server.flush().map_err(|error| failed(&error))?;
        let notified = self
            .server
            .configured(id, CONFIGURE_WAIT)
            .map_err(|error| failed(&error))?;
        let read_back = match notified {
            Some(read_back) => read_back,
            None => self.server.frame(id).map_err(|error| failed(&error))?,
        };
        Ok(FrameApplied {
            frame: read_back,
            immovable: false,
        })
    }

    /// `minimize: true` iconifies the window; `false` activates it.
    ///
    /// # Errors
    /// As [`Self::set_frame`]; a window the manager does not report afterwards reads
    /// `InvalidTarget{window_frame_unavailable}`.
    pub fn set_minimized(&mut self, window: &str, minimize: bool) -> BackendResult<()> {
        let id = window_id(window)?;
        let request = if minimize {
            WmRequest::Iconify
        } else {
            WmRequest::Activate
        };
        self.server
            .wm_request(id, request)
            .map_err(|error| failed(&error))?;
        self.server.flush().map_err(|error| failed(&error))?;
        self.server
            .frame(id)
            .map(drop)
            .map_err(|_| Refusal::new(EngineCode::InvalidTarget, Reason::WindowFrameUnavailable))
    }
}
