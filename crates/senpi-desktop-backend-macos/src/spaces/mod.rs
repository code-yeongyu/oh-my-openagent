//! Moving a window into the user's current Space through WindowServer's
//! runtime-resolved SkyLight Space functions (ported from oh-my-pi
//! `desktop/macos/spaces.rs`, MIT). No activation, Space switch, Dock
//! injection, or security-setting change is used as a substitute.

mod guard;
mod mover;
mod native;

pub(crate) use self::native::bring_to_current_space;

#[cfg(test)]
mod tests;
#[cfg(test)]
mod live_tests;
