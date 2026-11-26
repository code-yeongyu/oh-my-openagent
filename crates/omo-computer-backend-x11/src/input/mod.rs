//! Row 49: X11 input - XTEST under the foreground lease, grapheme typing through the active XKB
//! group (with the opt-in scratch-keycode remap), and the keys a user holds.

pub mod holds;
pub mod keys;
pub mod xtest;

#[cfg(test)]
mod tests;
