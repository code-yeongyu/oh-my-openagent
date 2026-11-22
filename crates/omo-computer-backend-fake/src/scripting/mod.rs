//! The scripted reads and effects the row-12 traits do not carry yet: identity, focus reads,
//! hits, user input, clipboard, frame verbs, held keys and the safety inputs. Each is an
//! inherent method of `FakeBackend` until the row that adds its trait method wires it.

mod effects;
mod policy;
mod reads;

pub use effects::{ClipboardRead, FrameResult};
pub use reads::FocusReadResult;

#[cfg(test)]
mod ported_tests;
#[cfg(test)]
mod tests;
