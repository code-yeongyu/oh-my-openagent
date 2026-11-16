//! X11 capture, input, toolkit evidence, stop path and presence.
#![cfg(target_os = "linux")]

pub mod apps;
mod backend;
pub mod capture;
pub mod diagnose;
mod displays;
pub mod epoch;
pub mod frame_verbs;
pub mod input;
mod monitors;
pub mod overlay;
pub mod self_set;
pub mod session_state;
pub mod stop_path;
pub mod toolkit;

pub use backend::{X11Backend, X11_BACKEND};
pub use capture::{list_windows, process_facts, CapturedFrame, ProcessFacts, X11Capture, X11Connection};
pub use monitors::{xft_dpi, ScaleSource};
