//! The display-awake power assertion, ported from oh-my-pi
//! `crates/pi-natives/src/power.rs` (its macOS `PreventDisplaySleep` kind).

use objc2_core_foundation::CFString;

const PREVENT_USER_IDLE_DISPLAY_SLEEP: &str = "PreventUserIdleDisplaySleep";
/// Shown by `pmset -g assertions` next to the engine process.
const DISPLAY_AWAKE_REASON: &str = "OmO computer use is operating the desktop";
/// `kIOPMAssertionLevelOn`.
const ASSERTION_LEVEL_ON: u32 = 255;

#[link(name = "IOKit", kind = "framework")]
unsafe extern "C" {
    fn IOPMAssertionCreateWithName(
        assertion_type: &CFString,
        assertion_level: u32,
        assertion_name: &CFString,
        assertion_id: *mut u32,
    ) -> i32;
    fn IOPMAssertionRelease(assertion_id: u32) -> i32;
}

/// Keeps the display from idle sleep until dropped.
pub(crate) struct DisplayAwakeAssertion(u32);

impl DisplayAwakeAssertion {
    /// # Errors
    /// The `IOReturn` of a refused assertion.
    pub(crate) fn start() -> Result<Self, i32> {
        let kind = CFString::from_static_str(PREVENT_USER_IDLE_DISPLAY_SLEEP);
        let reason = CFString::from_static_str(DISPLAY_AWAKE_REASON);
        let mut assertion_id = 0;
        // SAFETY: both CFStrings are live for the synchronous call, which
        // copies what it keeps; the level is IOKit's documented "on" value and
        // `assertion_id` is writable storage for the returned identifier.
        let status = unsafe {
            IOPMAssertionCreateWithName(&kind, ASSERTION_LEVEL_ON, &reason, &raw mut assertion_id)
        };
        if status == 0 {
            Ok(Self(assertion_id))
        } else {
            Err(status)
        }
    }
}

impl Drop for DisplayAwakeAssertion {
    fn drop(&mut self) {
        // SAFETY: the id came from the successful create this value owns, and
        // drop runs once, so the assertion is released exactly once.
        let status = unsafe { IOPMAssertionRelease(self.0) };
        if status != 0 {
            eprintln!(
                "senpi-desktop: releasing the display-awake assertion failed (IOReturn={status})"
            );
        }
    }
}

/// Starts the assertion. A refused one only means the display may sleep as it
/// would without the agent; failure notes report that.
pub(crate) fn hold_display_awake() -> Option<senpi_desktop_core::backend::DisplayAwakeHold> {
    match DisplayAwakeAssertion::start() {
        Ok(assertion) => Some(Box::new(assertion)),
        Err(status) => {
            eprintln!("senpi-desktop: the display-awake assertion was refused (IOReturn={status})");
            None
        }
    }
}
