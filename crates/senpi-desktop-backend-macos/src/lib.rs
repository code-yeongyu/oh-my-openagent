#![cfg(target_os = "macos")]

//! macOS desktop backend: Quartz capture, CGEvent input with SkyLight
//! background delivery and the focus guard, the AXUIElement accessibility
//! backend, and the `CGEventTap` kill switch (the `Global` stop path).

mod ax;
mod backend;
mod capture;
mod cursor;
mod focus;
mod front_app;
mod launch_gate;
mod launch_services;
mod overlay;
mod release_helper;
mod responsible;
mod input;
#[cfg(test)]
mod partial_coverage_tests;
mod skylight;
mod spaces;
mod stop_path;

pub use ax::{is_trusted, MacAx};
pub use backend::MacosBackend;
pub use input::{CanaryMode, CanaryResult};
pub use launch_gate::check_launch;
pub use stop_path::{CgEventTapListener, DEFAULT_STOP_CHORD};

pub const BACKEND_NAME: &str = env!("CARGO_PKG_NAME");

/// Private helper entry point used only by this engine executable.
pub fn run_cursor_overlay() -> std::io::Result<()> {
    overlay::run()
}

/// The input-release helper this engine executable starts for an input
/// request (`--release-helper`); refuses to run unless that engine spawned it.
///
/// # Errors
/// The refusal: not started by the engine whose pid and token its argv name.
pub fn run_release_helper() -> Result<(), String> {
    release_helper::run()
}
