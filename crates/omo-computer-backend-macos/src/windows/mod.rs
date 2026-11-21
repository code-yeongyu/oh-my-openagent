//! macOS windows (row 45): frame verbs with read-back and the window query.

pub mod frame;
pub mod query;
pub mod seam;

#[cfg(target_os = "macos")]
pub mod os;
#[cfg(test)]
mod tests;

pub use frame::MacWindows;
