//! `apps.list()` and `apps.open()` on macOS (row 45, acceptance 84).

pub mod list;
pub mod open;
pub mod seam;

#[cfg(target_os = "macos")]
pub mod os;
#[cfg(test)]
mod tests;
