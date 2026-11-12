//! The frames of one session: the latest capture of every target, every id ever issued, and
//! the session epoch they were captured in. A frame id is never issued twice in an engine
//! process; a coordinate call is admitted only against the target's latest, unconsumed frame
//! of the current epoch.

pub(crate) mod admit;
mod capture;

#[cfg(test)]
mod tests;

pub use capture::{CapturedFrame, ARTIFACT_TTL_MS};

use std::collections::hash_map::RandomState;
use std::collections::HashMap;
use std::hash::{BuildHasher, Hasher};
use std::sync::atomic::{AtomicU64, Ordering};

use omo_computer_core::frame::{FrameGeometry, FrameRefusal};
use omo_computer_core::params::ReportMode;

/// Captures recorded by this engine process, across every session and re-open.
static CAPTURES: AtomicU64 = AtomicU64::new(0);

/// One recorded capture.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Recorded {
    pub(crate) id: String,
    pub(crate) geometry: FrameGeometry,
    pub(crate) consumed: bool,
}

/// The frames of one session.
#[derive(Debug)]
pub struct FrameStore {
    /// Tells this store's object-mode ids from another engine's.
    instance: String,
    latest: HashMap<String, Recorded>,
    /// Every id issued, with the target it was issued for.
    issued: HashMap<String, String>,
    epoch: u64,
}

impl Default for FrameStore {
    fn default() -> Self {
        let mut hasher = RandomState::new().build_hasher();
        hasher.write_u32(std::process::id());
        Self {
            instance: format!("{:016x}", hasher.finish()),
            latest: HashMap::new(),
            issued: HashMap::new(),
            epoch: 0,
        }
    }
}

impl FrameStore {
    /// The session epoch.
    #[must_use]
    pub const fn epoch(&self) -> u64 {
        self.epoch
    }

    /// Moves the epoch: every frame recorded so far is superseded.
    pub(crate) fn bump_epoch(&mut self) -> u64 {
        self.epoch += 1;
        self.epoch
    }

    /// Records a capture of `target` as its latest frame and answers the new id: `frame-<n>`
    /// in a null-mode session (the v1 shape), `frame-<instance>-<n>` in object mode. `n` is
    /// the engine process's capture counter, so no id is issued twice.
    pub(crate) fn record(
        &mut self,
        target: &str,
        geometry: FrameGeometry,
        mode: ReportMode,
    ) -> String {
        let n = CAPTURES.fetch_add(1, Ordering::Relaxed).saturating_add(1);
        let id = match mode {
            ReportMode::Null => format!("frame-{n}"),
            ReportMode::Object => format!("frame-{}-{n}", self.instance),
        };
        self.issued.insert(id.clone(), target.to_owned());
        self.latest.insert(
            target.to_owned(),
            Recorded {
                id: id.clone(),
                geometry,
                consumed: false,
            },
        );
        id
    }

    /// The frame a coordinate call on `target` maps through: `frame_id`, else the target's
    /// latest.
    ///
    /// # Errors
    /// `WrongTarget`, `NoCapture`, `FrameRequired`, `Superseded` or `Consumed`, in that order.
    pub(crate) fn admit(
        &self,
        target: &str,
        frame_id: Option<&str>,
    ) -> Result<&Recorded, FrameRefusal> {
        let latest = self.latest.get(target);
        let frame = match frame_id {
            None => latest.ok_or(FrameRefusal::FrameRequired)?,
            Some(named) => {
                match self.issued.get(named) {
                    Some(owner) if owner != target => return Err(FrameRefusal::WrongTarget),
                    None => return Err(FrameRefusal::NoCapture),
                    Some(_) => {}
                }
                match latest {
                    Some(frame) if frame.id == named => frame,
                    Some(_) => return Err(FrameRefusal::Superseded),
                    None => return Err(FrameRefusal::NoCapture),
                }
            }
        };
        if frame.geometry.epoch < self.epoch {
            return Err(FrameRefusal::Superseded);
        }
        if frame.consumed {
            return Err(FrameRefusal::Consumed);
        }
        Ok(frame)
    }

    /// A `consume:true` call delivered through `frame_id`: the frame takes no further input.
    pub(crate) fn consume(&mut self, target: &str, frame_id: &str) {
        if let Some(frame) = self
            .latest
            .get_mut(target)
            .filter(|frame| frame.id == frame_id)
        {
            frame.consumed = true;
        }
    }
}
