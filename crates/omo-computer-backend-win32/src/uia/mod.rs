//! Windows UI Automation (row 59): the pure rules first - which providers self-activate, ref identity
//! from `RuntimeId`, the walk's bounds. The client, cache requests, change counters and secure
//! fields follow once rows 19 (settle) and 26 (secure mode) land.

pub mod bounds;
pub mod identity;
pub mod safety;

#[cfg(test)]
mod tests;
