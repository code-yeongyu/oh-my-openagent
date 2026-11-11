//! `InteractionLock` (RED stub: signatures only).

use std::io;
use std::path::{Path, PathBuf};

pub const LOCK_FILE: &str = "interaction.lock";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InteractionLock {
    path: PathBuf,
}

#[derive(Debug)]
pub struct LockGuard;

impl InteractionLock {
    #[must_use]
    pub fn under(runtime: &Path) -> Self {
        Self { path: runtime.join(LOCK_FILE) }
    }

    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// # Errors
    /// Never (stub).
    pub fn acquire(&self) -> io::Result<LockGuard> {
        Ok(LockGuard)
    }
}
