//! The frames of one session. Signatures only at the test-first commit.

mod capture;

#[cfg(test)]
mod tests;

pub use capture::{CapturedFrame, ARTIFACT_TTL_MS};

/// The frames of one session.
#[derive(Debug, Default)]
pub struct FrameStore {
    epoch: u64,
}

impl FrameStore {
    /// The session epoch.
    #[must_use]
    pub const fn epoch(&self) -> u64 {
        self.epoch
    }
}
