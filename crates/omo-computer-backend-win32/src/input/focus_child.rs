//! The posted route's target window: the focused child of the target's GUI thread
//! (`GetGUIThreadInfo().hwndFocus`), never the top-level frame, which drops a posted `WM_CHAR`. With
//! no focus window the post is refused `BackgroundUnavailable{no_focus_target}` before anything is
//! sent. Row 58 adds the sole-`DLGC_WANTCHARS`-descendant fallback to this same function.

use omo_computer_core::backend::Refusal;
use omo_computer_core::error::{EngineCode, Reason};

/// The Windows reads the resolver makes.
pub trait FocusOs {
    /// `GetWindowThreadProcessId(window)`'s thread, `None` for a dead window.
    fn window_thread(&self, window: isize) -> Option<u32>;
    /// `GetGUIThreadInfo(thread).hwndFocus`, `None` when the thread has no focus window.
    fn thread_focus(&self, thread: u32) -> Option<isize>;
}

/// The refusal when the target thread has no focus window.
pub const NO_FOCUS_TARGET: Refusal = Refusal::new(
    EngineCode::BackgroundUnavailable,
    Reason::NoFocusTarget.wire(),
);

/// The window a posted key or character goes to for the top-level `window`.
///
/// # Errors
/// [`NO_FOCUS_TARGET`] with nothing sent.
pub fn focus_child(os: &dyn FocusOs, window: isize) -> Result<isize, Refusal> {
    let thread = os.window_thread(window).ok_or(NO_FOCUS_TARGET)?;
    os.thread_focus(thread).ok_or(NO_FOCUS_TARGET)
}

#[cfg(windows)]
pub use os::Os;

#[cfg(windows)]
mod os {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetGUIThreadInfo, GetWindowThreadProcessId, GUITHREADINFO,
    };

    use super::FocusOs;

    /// The live seam.
    pub struct Os;

    impl FocusOs for Os {
        fn window_thread(&self, window: isize) -> Option<u32> {
            // SAFETY: any HWND value is accepted; a dead window answers 0.
            let thread =
                unsafe { GetWindowThreadProcessId(HWND(window as *mut core::ffi::c_void), None) };
            (thread != 0).then_some(thread)
        }

        fn thread_focus(&self, thread: u32) -> Option<isize> {
            let mut info = GUITHREADINFO {
                cbSize: u32::try_from(std::mem::size_of::<GUITHREADINFO>()).unwrap_or(0),
                ..Default::default()
            };
            // SAFETY: `info` has cbSize set.
            unsafe { GetGUIThreadInfo(thread, &mut info) }.ok()?;
            (!info.hwndFocus.is_invalid()).then_some(info.hwndFocus.0 as isize)
        }
    }
}
