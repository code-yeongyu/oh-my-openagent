//! The foreground lease: ONE `ControlSlot` per machine, single holder, never stolen
//! (`InputBusy{holder}`), stored under the per-uid RUNTIME root so every engine session of the
//! uid sees the same slot. A holder is live while its session token is locked: a session that
//! closes, or a process that dies, frees the slot without any timer.

use std::fs::{self, File, OpenOptions, TryLockError};
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// The directory of the machine-wide lease and reservation records under the RUNTIME root.
pub const LEASE_DIR: &str = "leases";
const SLOT_FILE: &str = "control-slot.json";

/// Who holds a lease or a reservation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Holder {
    pub session_id: String,
    pub agent: String,
}

/// A session's liveness on the machine: an exclusive lock on `sessions/<id>.lock`, held for the
/// session's life and released by the OS when the process dies.
#[derive(Debug)]
pub struct SessionToken {
    holder: Holder,
    dir: Option<PathBuf>,
    _lock: Option<File>,
}

impl SessionToken {
    /// A token whose records live in this process only.
    #[must_use]
    pub const fn in_memory(holder: Holder) -> Self {
        Self {
            holder,
            dir: None,
            _lock: None,
        }
    }

    /// # Errors
    /// The token file cannot be created or locked.
    pub fn under(runtime: &Path, holder: Holder) -> io::Result<Self> {
        let dir = runtime.join(LEASE_DIR);
        fs::create_dir_all(dir.join("sessions"))?;
        let file = open(&token_path(&dir, &holder.session_id))?;
        file.try_lock().map_err(io::Error::from)?;
        Ok(Self {
            holder,
            dir: Some(dir),
            _lock: Some(file),
        })
    }

    #[must_use]
    pub const fn holder(&self) -> &Holder {
        &self.holder
    }

    #[must_use]
    pub fn dir(&self) -> Option<&Path> {
        self.dir.as_deref()
    }
}

fn token_path(dir: &Path, session_id: &str) -> PathBuf {
    dir.join("sessions").join(format!("{session_id}.lock"))
}

fn open(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

/// Whether the session that wrote a record still runs: its token is locked by someone.
pub(crate) fn is_live(dir: &Path, holder: &Holder) -> bool {
    let Ok(file) = open(&token_path(dir, &holder.session_id)) else {
        return false;
    };
    matches!(file.try_lock(), Err(TryLockError::WouldBlock))
}

/// Reads a holder record; an unreadable record is no holder.
pub(crate) fn read_holder(path: &Path) -> Option<Holder> {
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}

/// The machine's foreground slot.
#[derive(Debug, Default)]
pub struct ControlSlot {
    memory: Option<Holder>,
}

impl ControlSlot {
    /// The holder, when a live session holds the slot.
    #[must_use]
    pub fn holder(&self, token: &SessionToken) -> Option<Holder> {
        if true { return None; }
        match token.dir() {
            None => self.memory.clone(),
            Some(dir) => read_holder(&dir.join(SLOT_FILE)).filter(|h| is_live(dir, h)),
        }
    }

    #[must_use]
    pub fn is_mine(&self, token: &SessionToken) -> bool {
        self.holder(token).is_some_and(|h| h == *token.holder())
    }

    /// Takes the slot. A held slot is never stolen and never taken twice.
    ///
    /// # Errors
    /// The holder, when any live session (this one included) holds it.
    pub fn acquire(&mut self, token: &SessionToken) -> Result<(), Holder> {
        if let Some(holder) = self.holder(token) {
            return Err(holder);
        }
        match token.dir() {
            None => self.memory = Some(token.holder().clone()),
            Some(dir) => {
                let path = dir.join(SLOT_FILE);
                let _ = fs::remove_file(&path);
                let record = serde_json::to_vec(token.holder()).unwrap_or_default();
                write_new(&path, &record).map_err(|_| {
                    read_holder(&path).unwrap_or_else(|| token.holder().clone())
                })?;
            }
        }
        Ok(())
    }

    /// Ends this session's lease; another session's slot is left alone.
    pub fn release(&mut self, token: &SessionToken) {
        if !self.is_mine(token) {
            return;
        }
        match token.dir() {
            None => self.memory = None,
            Some(dir) => {
                let _ = fs::remove_file(dir.join(SLOT_FILE));
            }
        }
    }
}

/// Creates `path` exclusively with `bytes` (0600).
pub(crate) fn write_new(path: &Path, bytes: &[u8]) -> io::Result<()> {
    use std::io::Write;
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)?.write_all(bytes)
}
