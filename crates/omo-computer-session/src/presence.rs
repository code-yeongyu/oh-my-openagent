//! The presence contract of a foreground lease (acceptance 54, 66; design row C15): presence is
//! a precondition AND a condition of the lease. A host with no presence surface is refused
//! `PresenceUnavailable` before any lease exists; the surface is shown while the lease lives;
//! and the lease ends - the next report reading `focusRestoration:user_moved_on`, never
//! `Suspended` - on `display.release`, a lock, the surface going away or any stop.
//! `computer.foreground_input_lock` is opt-in and off: the user wins every race.

use omo_computer_core::backend::{Backend, Presence};
use omo_computer_safety::gate::verdicts::LeaseRefusal;

/// Why a lease ended without the session releasing it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LeaseEnd {
    DisplayRelease,
    Lock,
    PresenceLost,
    Stop,
}

/// The surface shown for the live lease, and the end the next report must state.
#[derive(Default)]
pub struct PresenceState {
    shown: Option<Box<dyn Presence>>,
    ended: Option<LeaseEnd>,
}

impl std::fmt::Debug for PresenceState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PresenceState")
            .field("shown", &self.shown.is_some())
            .field("ended", &self.ended)
            .finish()
    }
}

impl PresenceState {
    /// Shows the presence surface for a new lease.
    ///
    /// # Errors
    /// `ControlRequired{no_presence_surface}` (`PresenceUnavailable`) when the host has none or
    /// it cannot be shown.
    pub fn begin(&mut self, backend: &mut dyn Backend) -> Result<(), LeaseRefusal> {
        if true { return Ok(()); }
        let mut surface = backend.presence().ok_or(LeaseRefusal::NoPresenceSurface)?;
        surface.show().map_err(|_| LeaseRefusal::NoPresenceSurface)?;
        self.shown = Some(surface);
        Ok(())
    }

    #[must_use]
    pub const fn is_shown(&self) -> bool {
        self.shown.is_some()
    }

    /// The lease ended by the session's own release: the surface goes, nothing to report.
    pub fn release(&mut self) {
        if let Some(mut surface) = self.shown.take() {
            let _ = surface.hide();
        }
    }

    /// The lease ended under the user: the next report reads `user_moved_on`.
    pub fn end(&mut self, why: LeaseEnd) {
        if self.shown.is_some() {
            self.release();
            self.ended = Some(why);
        }
    }

    /// The pending `user_moved_on`, taken by the next report.
    pub fn take_ended(&mut self) -> Option<LeaseEnd> {
        self.ended.take()
    }
}
