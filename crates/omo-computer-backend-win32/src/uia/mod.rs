//! Windows UI Automation (row 59): one client per session, cached batched reads, `RuntimeId`
//! identity and re-identification, the reader the bounded walk takes, change counters feeding
//! settle, the secure (password) focus, and the pure rules (pattern safety, walk bounds).

pub mod bounds;
pub mod cache;
pub mod client;
#[cfg(windows)]
mod com;
pub mod control_type;
pub mod counters;
pub mod element;
pub mod identity;
pub mod reach;
pub mod reader;
pub mod reidentify;
pub mod safety;
pub mod source;
#[cfg(windows)]
pub mod thread;

#[cfg(test)]
mod tests;
