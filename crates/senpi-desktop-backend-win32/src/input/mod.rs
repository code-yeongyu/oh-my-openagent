//! Win32 input. The key vocabulary ([`keys`]), the message packing
//! ([`messages`]), and the held-state ledger ([`held`]) are pure and tested
//! on every host; the routes themselves are Windows-only:
//! enigo/`SendInput` on the system input queue (desktop and foreground,
//! behind the `SetForegroundWindow` focus guard) and `PostMessageW` for
//! background delivery gated by [`crate::delivery`].

pub mod held;
pub mod keys;
pub mod messages;

#[cfg(target_os = "windows")]
mod background;
#[cfg(target_os = "windows")]
mod barrier;
#[cfg(target_os = "windows")]
mod char_sink;
#[cfg(target_os = "windows")]
mod dispatch;
#[cfg(target_os = "windows")]
mod foreground;
#[cfg(target_os = "windows")]
mod global;
#[cfg(target_os = "windows")]
mod native;
#[cfg(target_os = "windows")]
mod system;

#[cfg(target_os = "windows")]
pub(crate) use dispatch::{cursor_position, warp_cursor, Win32Input};
#[cfg(target_os = "windows")]
pub(crate) use foreground::raise_window;
#[cfg(target_os = "windows")]
pub(crate) use native::foreground_window_id;

#[cfg(test)]
mod tests;

#[cfg(all(test, target_os = "windows"))]
mod win_tests;

#[cfg(all(test, target_os = "windows"))]
pub(crate) mod live_tests;
