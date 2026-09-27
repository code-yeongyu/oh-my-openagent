//! The focus guard: foreground delivery gives the target the foreground
//! (`SetForegroundWindow`), confirms Win32 made it foreground, acts through
//! `SendInput`, waits until that input was delivered to the target
//! ([`barrier::delivered`]), and only then hands the foreground back to the
//! window that had it. oh-my-pi (`win32/input.rs:577-626`) restores without
//! that wait and races the raw input thread. Win32 grants the foreground only to
//! the process that received the last input event, so a refused request is
//! retried once after a zero-motion `SendInput` makes this process that
//! source. There is no `AttachThreadInput` fallback: a request still refused
//! is an error, never input sent to whichever window happens to be in front.

use std::thread;
use std::time::{Duration, Instant};

use senpi_desktop_core::error::{CoreResult, DesktopError};
use windows_sys::Win32::UI::WindowsAndMessaging::{IsIconic, ShowWindow, SW_RESTORE};

use super::barrier;
use super::dispatch::Win32Input;
use super::native::{self, Window};
use super::system;

/// How long Win32 gets to hand over the foreground.
const ACTIVATION_TIMEOUT: Duration = Duration::from_secs(1);
const ACTIVATION_POLL: Duration = Duration::from_millis(5);

impl Win32Input {
    /// Gives window `id` the foreground, runs `body`, waits until its input
    /// reached the target - also after a failed `body`, which may have sent
    /// part of it - then restores the previous foreground window. The restore is best effort here, as in
    /// oh-my-pi: the session's focus transaction restores the front window
    /// again through `restore_front_window` and reports a failure there.
    pub(super) fn with_foreground<T>(
        &mut self,
        id: &str,
        body: impl FnOnce(&mut Self) -> CoreResult<T>,
    ) -> CoreResult<T> {
        let target = Window::target(id, self.integrity)?;
        let previous = native::foreground();
        activate(id, target)?;
        let result = body(self);
        let delivered = barrier::delivered(target);
        if let Some(previous) = previous.filter(|&previous| previous != target) {
            // Refused restores are reported by the session's transaction.
            let _restored = native::set_foreground(previous);
        }
        result.and_then(|value| delivered.map(|()| value))
    }
}

/// Restores a minimized window and gives it the foreground.
///
/// # Errors
/// `InvalidTarget`/`WindowNotFound` for a bad id; `InputFailed` when Win32
/// refuses the foreground.
pub(crate) fn raise_window(id: &str) -> CoreResult<()> {
    let window = Window::parse(id)?;
    // SAFETY: [FFI] the HWND was validated by `Window::parse`; both calls
    // take it by value and retain nothing.
    unsafe {
        if IsIconic(window.hwnd()) != 0 {
            ShowWindow(window.hwnd(), SW_RESTORE);
        }
    }
    activate(id, window)
}

/// Asks Win32 to give `window` the foreground and waits until it reports so.
fn activate(id: &str, window: Window) -> CoreResult<()> {
    if native::foreground() == Some(window) {
        return Ok(());
    }
    if !native::set_foreground(window)
        && !(system::claim_last_input().is_ok() && native::set_foreground(window))
    {
        return Err(DesktopError::input_failed(format!(
            "SetForegroundWindow failed for window {id}"
        )));
    }
    let deadline = Instant::now() + ACTIVATION_TIMEOUT;
    loop {
        match native::foreground() {
            Some(active) if active == window => return Ok(()),
            active if Instant::now() >= deadline => {
                return Err(DesktopError::input_failed(format!(
                    "window {id} did not become the foreground window (foreground: {:?})",
                    active.map(Window::address)
                )));
            }
            Some(_) | None => thread::sleep(ACTIVATION_POLL),
        }
    }
}
