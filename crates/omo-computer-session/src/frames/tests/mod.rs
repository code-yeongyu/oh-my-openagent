//! Frames, the coordinate basis, epochs and displays on the fake: every frame refusal sends
//! nothing, an epoch change supersedes frames and expires refs, `displays()` stays complete,
//! and the default frame carries the pointer while a `crosshair` frame carries the falsifier.

mod capture;
mod epoch;
mod helpers;
mod refusals;
