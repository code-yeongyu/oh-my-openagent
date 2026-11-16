//! Windows capture, input, foreground lease, background delivery, UIA, permissions and the stop hook.
//!
//! Row 55: capture (`Windows.Graphics.Capture` first, the `PrintWindow` floor with the
//! near-black oracle, `BitBlt` per display), `displays()` and `Windows.Media.Ocr`.

pub mod backend;
pub mod barrier;
pub mod capture;
pub mod delivery;
pub mod displays;
pub mod input;
pub mod ocr;
pub mod release_helper;
pub mod route;
pub mod uia;

pub use backend::Win32Backend;

