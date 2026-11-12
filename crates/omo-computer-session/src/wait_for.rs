//! `waitFor`: one predicate, waited for on the settle's observer events and bounded by the
//! call's `timeout` on the backend's monotonic clock. No predicate lists windows or polls a
//! tree; the call ends on an observation of its target.

use omo_computer_core::backend::{
    AxEvent, NotificationFingerprint, Refusal, NO_NOTIFICATION_SURFACE,
};
use omo_computer_core::error::EngineCode;
use omo_computer_core::observation::{Observation, SettleOutcome};
use omo_computer_core::params::{ReportMode, WaitForParams, WindowState};
use omo_computer_core::requests::{read_wait_for, ReadRequest, SettleSpec, WaitSpec};
use omo_computer_core::results::{NotificationMatch, WaitOutcome, WaitResult};
use omo_computer_core::settle_profile::SettleRegime;
use omo_computer_core::untrusted::UntrustedText;

use crate::observe::{observe, Request};
use crate::refs::Unresolved;
use crate::session::{Session, NOT_OPEN};
use crate::settle::{event_kind, feed, window_state, BackendFeed, Feed};

/// `waitFor({notification:{}})` names neither `app` nor `title`: refused at the call.
pub const NOTIFICATION_UNNAMED: Refusal = Refusal::bare(EngineCode::InvalidTarget);

/// A backend without accessibility reads.
const NO_READER: Refusal = Refusal::new(EngineCode::AxUnsupported, "snapshot_unsupported");

/// A null-mode session has no `waitFor`.
const NO_CAPTURE: Refusal = Refusal::new(EngineCode::CaptureUnavailable, "capture_unsupported");

impl Session {
    /// # Errors
    /// [`NOT_OPEN`], a null-mode session, an unnamed `{notification}`, a backend without a
    /// notification surface, or the observation's refusal.
    pub fn wait_for(&mut self, params: WaitForParams) -> Result<WaitResult, Unresolved> {
        self.opened.as_ref().ok_or(NOT_OPEN)?;
        let ReadRequest::WaitFor { target, .. } = read_wait_for(params) else {
            unreachable!("read_wait_for always reads a waitFor");
        };
        let reader = self.backend.ax_reader().ok_or(NO_READER)?;
        let observation = observe(&mut self.refs, reader, &Request::of(&target))?;
        Ok(WaitResult {
            outcome: WaitOutcome::Timeout,
            observation: Box::new(observation),
            notification: None,
        })
    }
}
