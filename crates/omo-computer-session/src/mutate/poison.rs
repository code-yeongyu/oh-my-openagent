//! The callIds whose send was interrupted between the marker and the reply. Their completion
//! is unknown forever: every re-drive reads `delivery_uncertain/unsafe` and is never resent,
//! after the marker that recorded the crash is cleared (so the scope serves other calls), and
//! after an engine restart. On disk each one is an empty file
//! `markers/<issuer>/<scope>.uncertain/<callId>` under the RUNTIME root, created and fsynced
//! before the marker is cleared.

use std::collections::BTreeSet;
use std::fs::{File, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};

use crate::marker::{component, private_dir, MARKERS_DIR};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Poisoned {
    Memory(BTreeSet<(String, String, String)>),
    Dir(PathBuf),
}

impl Default for Poisoned {
    fn default() -> Self {
        Self::Memory(BTreeSet::new())
    }
}

impl Poisoned {
    pub(super) fn under(runtime: &Path) -> Self {
        Self::Dir(runtime.join(MARKERS_DIR))
    }

    /// Whether `call_id` crashed in this scope. A callId that cannot name a file was never
    /// recorded here (its marker, which still holds it, refuses it instead).
    pub(super) fn contains(&self, issuer: &str, scope: &str, call_id: &str) -> bool {
        match self {
            Self::Memory(set) => set.contains(&key(issuer, scope, call_id)),
            Self::Dir(root) => path(root, issuer, scope, call_id).is_ok_and(|path| path.exists()),
        }
    }

    /// Records `call_id` durably.
    ///
    /// # Errors
    /// The record could not be persisted; the caller keeps the crash marker instead.
    pub(super) fn insert(&mut self, issuer: &str, scope: &str, call_id: &str) -> io::Result<()> {
        match self {
            Self::Memory(set) => {
                set.insert(key(issuer, scope, call_id));
                Ok(())
            }
            Self::Dir(root) => {
                let path = path(root, issuer, scope, call_id)?;
                let dir = path
                    .parent()
                    .ok_or_else(|| io::Error::other("no directory"))?;
                private_dir(dir)?;
                let mut options = OpenOptions::new();
                options.write(true).create_new(true);
                #[cfg(unix)]
                {
                    use std::os::unix::fs::OpenOptionsExt;
                    options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
                }
                match options.open(&path) {
                    Ok(file) => file.sync_all()?,
                    Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
                    Err(error) => return Err(error),
                }
                File::open(dir)?.sync_all()
            }
        }
    }
}

fn key(issuer: &str, scope: &str, call_id: &str) -> (String, String, String) {
    (issuer.to_owned(), scope.to_owned(), call_id.to_owned())
}

fn path(root: &Path, issuer: &str, scope: &str, call_id: &str) -> io::Result<PathBuf> {
    Ok(root
        .join(component(issuer)?)
        .join(format!("{}.uncertain", component(scope)?))
        .join(component(call_id)?))
}
