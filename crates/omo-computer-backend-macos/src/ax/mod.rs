//! macOS accessibility (design `d-macos.md` 'Accessibility', row 43): batched attribute reads
//! (one IPC per node) under the 3,000 ms deadline with per-node cuts, the Chromium wake with
//! an observer-bounded wait and no sleep, one `AXObserver` per target app on the eleven
//! notifications feeding settle, the loading predicate of amendment A4, refs bound to retained
//! objects with the private remote-token resolve behind its probe, actions and the value
//! ladder, menus without focus moves, and the notification surface.

pub mod actions;
pub mod attributes;
pub mod chromium;
pub mod handles;
pub mod menus;
pub mod notifications;
pub mod reader;
pub mod seam;
pub mod settle;
pub mod table;

#[cfg(target_os = "macos")]
pub mod os;
#[cfg(test)]
mod tests;

pub use reader::MacAx;
