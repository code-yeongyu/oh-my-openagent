//! The callIds whose send was interrupted between the marker and the reply. Their completion
//! is unknown forever: every re-drive reads `delivery_uncertain/unsafe` and is never resent,
//! after the marker that recorded the crash is cleared (so the scope serves other calls), and
//! after an engine restart. On disk each one is an empty file
//! `markers/<issuer>/<scope>.uncertain/<callId>` under the RUNTIME root, created and fsynced
//! before the marker is cleared.
//!
//! The read fails CLOSED: an `uncertain/` directory that is a symlink or not a directory, and
//! any error reading it or the record other than "not there", count as poisoned. One error
//! reads as "not there" besides NotFound: ENOTDIR from an ancestor of `uncertain/` (a plain
//! file where `markers/` or the issuer directory belongs), because no record can exist under a
//! file and the marker cannot be written there either, so the call is still refused
//! (`marker_unavailable`) with nothing sent. Deleting the record itself is a same-uid tamper
//! the design does not defend against.

use std::collections::BTreeSet;
use std::fs::{self, File, OpenOptions};
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

    /// Whether `call_id` crashed in this scope, failing closed (see the module doc). A callId
    /// that cannot name a file was never recorded here (its marker, which still holds it,
    /// refuses it instead).
    pub(super) fn contains(&self, issuer: &str, scope: &str, call_id: &str) -> bool {
        match self {
            Self::Memory(set) => set.contains(&key(issuer, scope, call_id)),
            Self::Dir(root) => path(root, issuer, scope, call_id).is_ok_and(|path| recorded(&path)),
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

/// The record at `path` is there, or cannot be proven absent.
fn recorded(path: &Path) -> bool {
    let Some(dir) = path.parent() else {
        return true;
    };
    match fs::symlink_metadata(dir) {
        Err(error) => !absent(&error),
        Ok(meta) if !meta.is_dir() => true,
        Ok(_) => fs::symlink_metadata(path)
            .map_or_else(|error| error.kind() != io::ErrorKind::NotFound, |_| true),
    }
}

/// "Not there": the directory is missing, or an ancestor is a plain file.
fn absent(error: &io::Error) -> bool {
    #[cfg(unix)]
    let ancestor_not_a_dir = error.raw_os_error() == Some(libc::ENOTDIR);
    #[cfg(not(unix))]
    let ancestor_not_a_dir = false;
    error.kind() == io::ErrorKind::NotFound || ancestor_not_a_dir
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
