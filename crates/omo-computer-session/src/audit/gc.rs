//! Bounded artifact retention (RED stub: sweeps nothing).

use std::io;
use std::path::{Path, PathBuf};

pub const ARTIFACT_PREFIX: &str = "senpi-computer-";

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct GcLimits {
    pub stale_ms: u64,
    pub max_bytes: u64,
    pub max_files: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SweepTrigger {
    Open,
    IdleExit,
    Timer,
    CapCrossing,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SweepReport {
    pub trigger: SweepTrigger,
    pub at_ms: u64,
    pub removed: u64,
    pub bytes: u64,
    pub files: u64,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArtifactStore {
    dir: PathBuf,
}

#[must_use]
pub fn artifact_name(digest: &str, ext: &str) -> String {
    format!("{ARTIFACT_PREFIX}{digest}.{ext}")
}

impl ArtifactStore {
    #[must_use]
    pub const fn new(dir: PathBuf, _limits: GcLimits) -> Self {
        Self { dir }
    }

    #[must_use]
    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// # Errors
    /// Never (stub).
    pub fn record(&mut self, digest: &str, ext: &str, _bytes: &[u8], _now_ms: u64) -> io::Result<PathBuf> {
        Ok(self.dir.join(artifact_name(digest, ext)))
    }

    pub const fn release(&mut self, _digest: &str) -> bool {
        false
    }

    pub fn sweep(&mut self, now_ms: u64, trigger: SweepTrigger) -> SweepReport {
        SweepReport { trigger, at_ms: now_ms, removed: 0, bytes: 0, files: 0, warnings: Vec::new() }
    }
}
