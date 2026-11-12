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
