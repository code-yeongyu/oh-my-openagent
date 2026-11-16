//! macOS capture, input, background delivery, AX, windows, permissions and the stop path.
//!
//! Row 41: the window enumerator, capture through the persistent capture helper (the SkyLight
//! window route behind its symbol probe), exclusion of the engine's own windows, `displays()`
//! and the preview lane. Row 45: window frame verbs, Spaces, epoch sources, the display-awake
//! assertion and apps.

pub mod apps;
pub mod capture;
pub mod displays;
pub mod epoch;
pub mod power;
pub mod spaces;
pub mod windows;
