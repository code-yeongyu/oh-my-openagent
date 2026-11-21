//! The lease-end extension point (R45): every lease end - `control.release`, `display.release`,
//! a user-side end - reaches `end_lease`, which hands its cause to the session's hook once, and
//! `display.resume` does the same. The default hook does nothing; a later row installs its own
//! with `Session::set_lease_hook` and keeps its state inside the hook.

use omo_computer_core::backend::Backend;

use crate::presence::LeaseEnd;

pub trait LeaseHook: Send {
    fn lease_ended(&mut self, _backend: &mut dyn Backend, _why: LeaseEnd) {}

    fn display_resumed(&mut self, _backend: &mut dyn Backend) {}
}

/// The default: no row has installed a hook.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoLeaseHook;

impl LeaseHook for NoLeaseHook {}
