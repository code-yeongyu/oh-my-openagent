use std::ffi::c_void;
use std::ptr;

use super::{tap_callback, CGEventTapEnable, Shared, TapContext, TAP_DISABLED_BY_TIMEOUT};

#[derive(Debug, Clone, Copy)]
pub(in crate::stop_path) enum Simulate {
    /// The OS disables the tap and tells the callback it timed out.
    DisabledByTimeout,
    /// The tap is disabled and stays so.
    Disabled,
}

#[derive(Debug, Default)]
pub(in crate::stop_path) struct TestHooks {
    pub(in crate::stop_path) reenabled: Vec<u32>,
    pub(in crate::stop_path) simulate: Option<Simulate>,
    /// Whether the step right after the last simulation stayed live.
    pub(in crate::stop_path) simulated_step_live: Option<bool>,
    /// Times a tap went live.
    pub(in crate::stop_path) went_live: u64,
    /// Key-downs the callback ignored because a process posted them.
    pub(in crate::stop_path) posted_ignored: u64,
}

pub(super) fn apply(context: &TapContext<'_>, user_info: *mut c_void) -> bool {
    let Some(simulate) = context.shared.control.lock().hooks.simulate.take() else {
        return false;
    };
    // SAFETY: [FFI] called on the tap thread while `run` holds the port.
    unsafe { CGEventTapEnable(context.tap.get(), false) };
    match simulate {
        Simulate::DisabledByTimeout => {
            tap_callback(
                ptr::null_mut(),
                TAP_DISABLED_BY_TIMEOUT,
                ptr::null_mut(),
                user_info,
            );
        }
        Simulate::Disabled => {}
    }
    true
}

pub(super) fn record(shared: &Shared, simulated: bool, live: bool) {
    if simulated {
        shared.update(|control| control.hooks.simulated_step_live = Some(live));
    }
}
