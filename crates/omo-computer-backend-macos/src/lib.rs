//! macOS capture, input, background delivery, AX, windows, permissions and the stop path.
//!
//! Row 41: the window enumerator, capture through the persistent capture helper (the SkyLight
//! window route behind its symbol probe), exclusion of the engine's own windows, `displays()`
//! and the preview lane.

pub mod capture;
pub mod displays;
