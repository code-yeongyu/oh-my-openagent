//! Row 22's registration on row 21's lease-end hook (R45): a lease end releases the
//! display-awake hold when the hold is held or the cause is `display.release` (which parks it
//! even when idle, so session open's lease end leaves an idle hold alone), and
//! `display.resume` re-arms it.

use omo_computer_core::backend::Backend;

use super::display_awake::SharedHold;
use crate::grant::LeaseHook;
use crate::presence::LeaseEnd;

pub(crate) struct DisplayAwakeLeaseHook(pub(crate) SharedHold);

impl LeaseHook for DisplayAwakeLeaseHook {
    fn lease_ended(&mut self, _backend: &mut dyn Backend, why: LeaseEnd) {
        self.0.update(|hold| {
            if matches!(why, LeaseEnd::DisplayRelease) || hold.holds_display_awake() {
                hold.release()
            } else {
                hold
            }
        });
    }

    fn display_resumed(&mut self, _backend: &mut dyn Backend) {
        self.0.update(super::DisplayAwakeHold::resume);
    }
}

/// Registers the display-awake rule on the session's lease hook, sharing the session's one
/// hold handle (R45); `Session::with_guard` builds every session through it.
pub(crate) fn with_display_awake(mut session: crate::Session) -> crate::Session {
    let hold = session.display_awake.clone();
    session.set_lease_hook(Box::new(DisplayAwakeLeaseHook(hold)));
    session
}

impl crate::Session {
    /// Every session is built here, so the lease hooks are installed on its own funnel.
    pub(crate) fn build(backend: Box<dyn Backend>, guard: omo_computer_safety::Guard, funnel: crate::mutate::Funnel) -> Self {
        with_display_awake(Self {
            backend,
            guard,
            opened: None,
            funnel,
            refs: crate::refs::RefRegistry::default(),
            frames: crate::frames::FrameStore::default(),
            trace: crate::trace::Trace::default(),
            display_awake: crate::intervention::SharedHold::default(),
        })
    }
}
