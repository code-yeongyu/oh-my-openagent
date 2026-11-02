//! The compositor half of the foreground focus guard (#9095). Raising the
//! target changes the window order in win32k at once, but DWM's hit-testing
//! of mouse input catches up only with the next frame it presents. A wheel
//! injected in between, at a point the raise uncovered, reaches no window:
//! measured on the hosted Windows runner, a wheel within 5 ms of the raise
//! was lost in 6 of 6 runs and within 16 ms in 3 of 6, while waiting for the
//! next present (`DwmFlush`, 6 to 35 ms there) delivered it in 18 of 18.

use windows_sys::Win32::Graphics::Dwm::DwmFlush;

/// Blocks until DWM presents its next frame, so pointer input sent after
/// this is hit-tested against the window order the raise produced.
pub(super) fn await_next_present() {
    // DwmFlush fails only when DWM is not composing this session; then mouse
    // input is hit-tested by win32k alone, which already sees the new order,
    // so there is nothing to wait for and its HRESULT carries no decision.
    // SAFETY: [FFI] no arguments; the call blocks until the next present.
    unsafe { DwmFlush() };
}
