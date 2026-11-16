//! macOS capture (design `d-macos.md` 'Capture', row 41): the own window enumerator, the
//! persistent ScreenCaptureKit capture helper as the default route with the SkyLight window
//! capture behind its per-symbol probe, exclusion of the engine's own windows, and the
//! preview lane. No `xcap`, no `/usr/sbin/screencapture`, no stream frame for the model.
//!
//! Probe ledger (`probes/macos-spi.tsv`, spike row 6): `hwcapture` (`SLSHWCaptureWindowList`)
//! and `copy-spaces` (`SLSCopySpacesForWindows`) are UNMEASURED on 15 and 26, so both are
//! resolved per symbol at run time and an unresolved symbol is `None`, never a crash.

pub mod capturer;
pub mod enumerate;
pub mod exclusion;
pub mod helper;
pub mod pixels;
pub mod preview;
pub mod route;
pub mod seam;
pub mod types;

#[cfg(test)]
mod tests;

pub use capturer::Capturer;
pub use route::CaptureRouteTaken;
