//! Presence exclusion (d-windows.md '## Capture guard and input lock', Presence):
//! `capabilities().presence.exclusion` is `affinity` only when the spike's affinity row CONFIRMS
//! that `WDA_EXCLUDEFROMCAPTURE` keeps the overlay out of captures (SP-N #13145@e0e08a126e:
//! n-affinity-wgc-monitor, n-affinity-printwindow-overlapped, n-affinity-wgc-window-overlapped,
//! n-affinity-gdi-bitblt) AND the live cover-window oracle reads 0 leaked pixels; otherwise
//! `hide_ack`: the overlay is hidden and acknowledged before every model-bound capture.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Exclusion {
    Affinity,
    HideAck,
}

/// `leaked_px` is the cover-window oracle's reading on this build, `None` when not measured.
#[must_use]
pub const fn exclusion(spike_confirms: bool, leaked_px: Option<u64>) -> Exclusion {
    match (spike_confirms, leaked_px) {
        (true, Some(0)) => Exclusion::Affinity,
        _ => Exclusion::HideAck,
    }
}

/// What the Windows display-awake request does to follow the session's hold.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AwakeAction {
    Acquire,
    Keep,
    Release,
}

/// `held` is row 22's `DisplayAwakeHold::holds_display_awake()`; `have` whether a request is set.
#[must_use]
pub const fn sync(held: bool, have: bool) -> AwakeAction {
    match (held, have) {
        (true, false) => AwakeAction::Acquire,
        (false, true) => AwakeAction::Release,
        _ => AwakeAction::Keep,
    }
}

#[cfg(windows)]
pub use power::PowerRequest;

/// `PowerCreateRequest` + `PowerSetRequest(PowerRequestDisplayRequired)` with a reason naming the
/// session (visible in `powercfg /requests`); `SetThreadExecutionState` is not used.
#[cfg(windows)]
mod power {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::System::Power::{
        PowerClearRequest, PowerCreateRequest, PowerRequestDisplayRequired, PowerSetRequest,
    };
    use windows::Win32::System::Threading::{
        POWER_REQUEST_CONTEXT_SIMPLE_STRING, REASON_CONTEXT, REASON_CONTEXT_0,
    };

    /// One display-required request, cleared and closed on drop.
    pub struct PowerRequest {
        handle: HANDLE,
        set: bool,
    }

    impl PowerRequest {
        /// Creates the request with `reason` (e.g. `omo computer use: <session>`).
        ///
        /// # Errors
        /// The Win32 error of `PowerCreateRequest` (the capability then reads `unavailable`).
        pub fn create(reason: &str) -> windows::core::Result<Self> {
            let mut text: Vec<u16> = reason.encode_utf16().chain(Some(0)).collect();
            let context = REASON_CONTEXT {
                Version: 0,
                Flags: POWER_REQUEST_CONTEXT_SIMPLE_STRING,
                Reason: REASON_CONTEXT_0 {
                    SimpleReasonString: PWSTR(text.as_mut_ptr()),
                },
            };
            // SAFETY: `context` and its string live across the call.
            let handle = unsafe { PowerCreateRequest(&context)? };
            Ok(Self { handle, set: false })
        }

        /// Holds the display on (the hold went to `held`).
        ///
        /// # Errors
        /// The Win32 error of `PowerSetRequest`.
        pub fn acquire(&mut self) -> windows::core::Result<()> {
            // SAFETY: the handle PowerCreateRequest returned.
            unsafe { PowerSetRequest(self.handle, PowerRequestDisplayRequired)? };
            self.set = true;
            Ok(())
        }

        /// Lets the display sleep again (released, lapsed, capped or closed).
        ///
        /// # Errors
        /// The Win32 error of `PowerClearRequest`.
        pub fn release(&mut self) -> windows::core::Result<()> {
            if self.set {
                // SAFETY: the handle PowerCreateRequest returned.
                unsafe { PowerClearRequest(self.handle, PowerRequestDisplayRequired)? };
                self.set = false;
            }
            Ok(())
        }

        #[must_use]
        pub const fn is_set(&self) -> bool {
            self.set
        }
    }

    impl Drop for PowerRequest {
        fn drop(&mut self) {
            let _ = self.release();
            // SAFETY: closed once.
            let _ = unsafe { CloseHandle(self.handle) };
        }
    }
}
