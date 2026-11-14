//! The frame check of a coordinate call: the frame it names (or the target's latest), the
//! window basis `{windowNumber|hwnd|xid, pid, processStart}`, then `map_point`. It reads only;
//! the funnel refuses on its verdict before any input is sent.

use omo_computer_core::backend::WindowFilter;
use omo_computer_core::frame::FrameRefusal;
use omo_computer_core::listing::WindowInfo;
use omo_computer_core::params::Point;

use crate::Session;

/// The frame a call is admitted against and the desktop point its coordinate maps to.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct FrameAdmission {
    pub(crate) frame_id: String,
    pub(crate) point: Point,
}

/// The frame key of a call's target: a call with no target aims at the desktop.
pub(crate) fn frame_key(target: Option<&str>) -> String {
    target.unwrap_or("desktop").to_owned()
}

impl Session {
    /// The listed window `id`, read now.
    pub(crate) fn window(&mut self, id: &str) -> Option<WindowInfo> {
        self.backend
            .windows(&WindowFilter::default())
            .ok()
            .and_then(|list| list.windows.into_iter().find(|window| window.id == id))
    }

    /// Admits the frame coordinate `(x, y)` of a call on `target` (after any pending epoch
    /// change is applied).
    ///
    /// # Errors
    /// The first of the nine frame refusals that holds.
    pub(crate) fn admit_frame(
        &mut self,
        target: &str,
        frame_id: Option<&str>,
        x: f64,
        y: f64,
    ) -> Result<FrameAdmission, FrameRefusal> {
        self.poll_epoch();
        let frame = self.frames.admit(target, frame_id)?.clone();
        let current = match frame.geometry.basis() {
            None => None,
            Some(basis) => match self.window(target) {
                Some(window) if &window.identity == basis => Some(window.bounds),
                _ => return Err(FrameRefusal::IdentityChanged),
            },
        };
        let (x, y) = frame.geometry.map_point(x, y, current.as_ref())?;
        Ok(FrameAdmission {
            frame_id: frame.id,
            point: Point { x, y },
        })
    }
}
