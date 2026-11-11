//! Read 4 / exec 1 permits per session. Same-session calls queue behind a held permit with
//! the run's deadline; a session is never answered "busy" for its own calls, so a call that
//! finds no permit free waits, and this type only counts.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

pub const READ_PERMITS: u32 = 4;
pub const EXEC_PERMITS: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PermitKind {
    Read,
    Exec,
}

#[derive(Debug, Clone, Default)]
pub struct Permits {
    read: Arc<AtomicU32>,
    exec: Arc<AtomicU32>,
}

/// A held permit, returned on drop.
#[derive(Debug)]
pub struct Permit {
    held: Arc<AtomicU32>,
}

impl Drop for Permit {
    fn drop(&mut self) {
        self.held.fetch_sub(1, Ordering::AcqRel);
    }
}

impl Permits {
    /// Takes a permit of `kind` when one is free.
    #[must_use]
    pub fn try_take(&self, kind: PermitKind) -> Option<Permit> {
        let (held, cap) = match kind {
            PermitKind::Read => (&self.read, READ_PERMITS),
            PermitKind::Exec => (&self.exec, EXEC_PERMITS),
        };
        held.try_update(Ordering::AcqRel, Ordering::Acquire, |now| {
            (now < cap).then_some(now + 1)
        })
        .ok()
        .map(|_| Permit {
            held: Arc::clone(held),
        })
    }

    /// Permits of `kind` held now.
    #[must_use]
    pub fn held(&self, kind: PermitKind) -> u32 {
        match kind {
            PermitKind::Read => self.read.load(Ordering::Acquire),
            PermitKind::Exec => self.exec.load(Ordering::Acquire),
        }
    }
}
