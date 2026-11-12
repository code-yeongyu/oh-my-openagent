//! Windows capture, input, foreground lease, background delivery, UIA, permissions and the stop hook.
//!
//! Row 55: capture (`Windows.Graphics.Capture` first, the `PrintWindow` floor with the
//! near-black oracle, `BitBlt` per display), `displays()` and `Windows.Media.Ocr`.

pub mod backend;
pub mod capture;
pub mod displays;
pub mod ocr;

pub use backend::Win32Backend;

#[cfg(test)]
mod tests;
