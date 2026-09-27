#![cfg(target_os = "macos")]

//! macOS desktop backend: Quartz capture, CGEvent input with SkyLight
//! background delivery and the focus guard, the AXUIElement accessibility
//! backend, and the `CGEventTap` kill switch (the `Global` stop path).

mod ax;
mod backend;
mod capture;
mod cursor;
mod focus;
mod input;
mod skylight;
mod stop_path;

pub use ax::{is_trusted, MacAx};
pub use backend::MacosBackend;
pub use input::{CanaryMode, CanaryResult};
pub use stop_path::{CgEventTapListener, DEFAULT_STOP_CHORD};

pub const BACKEND_NAME: &str = env!("CARGO_PKG_NAME");
