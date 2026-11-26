//! X11 capture, input, toolkit evidence, stop path and presence.
#![cfg(target_os = "linux")]

mod backend;
pub mod capture;
mod displays;
mod monitors;

pub use backend::{X11Backend, X11_BACKEND};
pub use capture::{list_windows, process_facts, CapturedFrame, ProcessFacts, X11Capture, X11Connection};
pub use monitors::{xft_dpi, ScaleSource};
