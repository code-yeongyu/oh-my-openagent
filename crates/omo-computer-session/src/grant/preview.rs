//! Admission and delivery for the session host’s foreground preview.

use omo_computer_core::backend::FrameBytes;

use crate::preview::{Dropped, PreviewFrame};
use crate::Session;

impl Session {
    pub fn preview_subscribe(&mut self) {
        self.funnel.control.preview.subscribe();
    }

    /// A captured frame for the preview lane; emitted only to a subscriber during a lease.
    ///
    /// # Errors
    /// Why the frame was dropped.
    pub fn offer_preview(&mut self, frame: FrameBytes) -> Result<(), Dropped> {
        self.check_preview_delivery()?;
        let now = self.funnel.control.now_ms();
        self.funnel.control.preview.offer_eligible(now, frame)
    }

    /// The frames for the host's `preview.frame` notifications.
    /// Poll the stop listener before delivery: a hotkey may have ended the lease since the offer.
    pub fn take_preview_frames(&mut self) -> Vec<PreviewFrame> {
        if self.check_preview_delivery().is_err() {
            return Vec::new();
        }
        self.funnel.control.preview.drain()
    }

    fn check_preview_delivery(&mut self) -> Result<(), Dropped> {
        use omo_computer_core::session_state::Tristate;
        if !self.funnel.control.preview.is_subscribed() {
            return Err(Dropped::NotSubscribed);
        }
        self.reconcile_stop();
        let refusal = if !self.holds_lease() {
            Dropped::NoLease
        } else if !self.opened.as_ref().is_some_and(|s| s.preview_enabled) {
            Dropped::PictureWithheld
        } else {
            let state = self.backend.capabilities().session;
            if state.screen_locked == Tristate::Known(false) && state.secure_input_active == Tristate::Known(false) {
                return Ok(());
            }
            Dropped::PictureWithheld
        };
        self.funnel.control.preview.discard_pending();
        Err(refusal)
    }
}
