//! Conditional WindowServer hand-back ABI, from oh-my-pi 0838d2ab44 (MIT).

use std::ffi::c_void;
use std::sync::LazyLock;

use objc2_core_foundation::{CFDictionary, CFNumber, CFString};
use senpi_desktop_core::error::{CoreResult, DesktopError};

use super::super::psn::{ProcessSerialNumber, SET_FRONT_NO_WINDOWS};
use super::super::spi;

type ConditionalFn =
    unsafe extern "C" fn(*const ProcessSerialNumber, u32, u32, *const c_void) -> i32;
type KeyFocusFn = unsafe extern "C" fn(*mut ProcessSerialNumber, *mut u8) -> i32;
type PidFn = unsafe extern "C" fn(*const ProcessSerialNumber, *mut libc::pid_t) -> i32;

struct Conditional {
    set_front: ConditionalFn,
    timestamp_key: *const CFString,
}

// SAFETY: The pointer names an immutable process-lived SkyLight constant.
unsafe impl Send for Conditional {}
// SAFETY: No caller mutates the constant.
unsafe impl Sync for Conditional {}

static CONDITIONAL: LazyLock<Option<Conditional>> = LazyLock::new(|| {
    spi::ensure_skylight_loaded()?;
    let key: *const *const CFString = spi::symbol(c"kSLSSetFrontProcessRequestTimestampKey")?;
    // SAFETY: dlsym resolved the exact exported CFString pointer.
    let timestamp_key = unsafe { key.read() };
    if timestamp_key.is_null() {
        return None;
    }
    Some(Conditional {
        set_front: spi::symbol(c"SLSSetFrontProcessWithInfo")?,
        timestamp_key,
    })
});

pub(super) fn event_clock() -> u64 {
    let mut time = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    // SAFETY: The out pointer is writable for the synchronous read.
    unsafe { libc::clock_gettime(libc::CLOCK_UPTIME_RAW, &mut time) };
    u64::try_from(time.tv_sec).unwrap_or(0) * 1_000_000_000
        + u64::try_from(time.tv_nsec).unwrap_or(0)
}

pub(super) fn hand_back(psn: &ProcessSerialNumber, wid: u32, since: u64) -> CoreResult<bool> {
    let status = if let Some(conditional) = CONDITIONAL.as_ref() {
        let timestamp = CFNumber::new_i64(i64::try_from(since).unwrap_or(i64::MAX));
        // SAFETY: The symbol is an immutable process-lived CFString.
        let key = unsafe { &*conditional.timestamp_key };
        let info = CFDictionary::<CFString, CFNumber>::from_slices(&[key], &[&*timestamp]);
        // SAFETY: PSN and dictionary live through the exact-ABI synchronous call.
        unsafe {
            (conditional.set_front)(
                psn,
                wid,
                SET_FRONT_NO_WINDOWS,
                std::ptr::from_ref(&*info).cast(),
            )
        }
    } else {
        let spi = spi::foreground().ok_or_else(|| {
            DesktopError::input_failed("focus restoration SPI became unavailable")
        })?;
        // SAFETY: PSN was resolved from the live WindowServer process.
        unsafe { (spi.set_front)(psn, wid, SET_FRONT_NO_WINDOWS) }
    };
    match status {
        0 => Ok(true),
        -13066 => Ok(false),
        _ => Err(DesktopError::input_failed(
            "WindowServer rejected background focus restoration",
        )),
    }
}

pub(crate) fn keyboard_focus_pid() -> Option<u32> {
    static READERS: LazyLock<Option<(KeyFocusFn, PidFn)>> = LazyLock::new(|| {
        spi::ensure_skylight_loaded()?;
        Some((
            spi::symbol(c"SLPSGetKeyFocusProcess")?,
            spi::symbol(c"GetProcessPID")?,
        ))
    });
    let (focus, pid_of) = (*READERS)?;
    let mut psn = ProcessSerialNumber::default();
    let mut status = 0;
    let mut pid = 0;
    // SAFETY: Both output records match the documented native ABIs.
    if unsafe { focus(&mut psn, &mut status) } != 0 || unsafe { pid_of(&psn, &mut pid) } != 0 {
        return None;
    }
    u32::try_from(pid).ok().filter(|pid| *pid > 0)
}
