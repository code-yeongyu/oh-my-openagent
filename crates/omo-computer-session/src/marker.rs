//! The pre-input marker: `markers/<issuer>/<scope>.json` under the per-uid RUNTIME root,
//! one outstanding per `(issuer, scope)`. It is created `O_CREAT|O_EXCL` (0600, no symlink
//! followed) and fsynced, file and directory, BEFORE the first OS event of every exec call on
//! every transport; the reply is stored in it as the receipt once the call completes. A file
//! that is there and cannot be read as a marker reads `Unreadable`, never absent.

use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::audit::TextRecord;

/// The markers directory under the RUNTIME root.
pub const MARKERS_DIR: &str = "markers";

/// The marker format version.
pub const MARKER_VERSION: u8 = 1;

/// The mutation binding a marker carries: `(issuer, scope, callId, runGeneration)` and the
/// `hello.generation` of the engine that wrote it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarkerBinding {
    pub issuer: String,
    pub scope: String,
    pub call_id: String,
    pub run_generation: u64,
    pub generation: u64,
}

/// The stored reply of a completed call.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Receipt {
    pub reply: Value,
}

/// `PreInputMarker`: text as `{length, sha256_16}`, or `{length}` only under the secure
/// predicate; never the text itself.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreInputMarker {
    pub v: u8,
    pub binding: MarkerBinding,
    pub action: String,
    pub target: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frame_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<TextRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keys: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
    pub issued_at: String,
    /// Informational (audit reconciliation), never an admission rule.
    pub expires_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub receipt: Option<Receipt>,
}

/// What a read of one `(issuer, scope)` marker found.
#[derive(Debug, Clone, PartialEq)]
pub enum MarkerRead {
    Absent,
    Found(Box<PreInputMarker>),
    /// A file is there and is not a marker this uid wrote: read as outstanding.
    Unreadable,
}

/// Where markers persist.
pub trait MarkerStore: Send {
    fn read(&self, issuer: &str, scope: &str) -> MarkerRead;

    /// Creates the marker exclusively and makes it durable before returning.
    ///
    /// # Errors
    /// The marker could not be persisted (a marker already there included).
    fn create(&mut self, marker: &PreInputMarker) -> io::Result<()>;

    /// Replaces the marker with its receipt-carrying copy, durably.
    ///
    /// # Errors
    /// The copy could not be written.
    fn record_receipt(&mut self, marker: &PreInputMarker) -> io::Result<()>;

    /// # Errors
    /// The marker could not be removed.
    fn clear(&mut self, issuer: &str, scope: &str) -> io::Result<()>;
}

/// The marker files under one RUNTIME root.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MarkerDir {
    root: PathBuf,
}

impl MarkerDir {
    #[must_use]
    pub fn under(runtime: &Path) -> Self {
        Self {
            root: runtime.join(MARKERS_DIR),
        }
    }

    /// `markers/<issuer>/<scope>.json`.
    ///
    /// # Errors
    /// The issuer or scope is not a plain path component.
    pub fn path(&self, issuer: &str, scope: &str) -> io::Result<PathBuf> {
        Ok(self
            .root
            .join(component(issuer)?)
            .join(format!("{}.json", component(scope)?)))
    }
}

impl MarkerStore for MarkerDir {
    fn read(&self, issuer: &str, scope: &str) -> MarkerRead {
        let Ok(path) = self.path(issuer, scope) else {
            return MarkerRead::Unreadable;
        };
        match open_no_follow(&path) {
            Err(error) if no_such_marker(&error) => MarkerRead::Absent,
            Err(_) => MarkerRead::Unreadable,
            Ok(mut file) => {
                let mut text = String::new();
                let owned = owner_ok(&file);
                match (owned, file.read_to_string(&mut text)) {
                    (true, Ok(_)) => serde_json::from_str::<PreInputMarker>(&text)
                        .map_or(MarkerRead::Unreadable, |marker| {
                            MarkerRead::Found(Box::new(marker))
                        }),
                    _ => MarkerRead::Unreadable,
                }
            }
        }
    }

    fn create(&mut self, marker: &PreInputMarker) -> io::Result<()> {
        let path = self.path(&marker.binding.issuer, &marker.binding.scope)?;
        let dir = parent(&path)?;
        private_dir(&self.root)?;
        private_dir(dir)?;
        write_new(&path, &serde_json::to_vec(marker)?)?;
        File::open(dir)?.sync_all()
    }

    fn record_receipt(&mut self, marker: &PreInputMarker) -> io::Result<()> {
        let path = self.path(&marker.binding.issuer, &marker.binding.scope)?;
        let dir = parent(&path)?;
        let temp = dir.join(format!(
            ".{}.{}.tmp",
            marker.binding.scope,
            std::process::id()
        ));
        let _ = fs::remove_file(&temp);
        write_new(&temp, &serde_json::to_vec(marker)?)?;
        fs::rename(&temp, &path)?;
        File::open(dir)?.sync_all()
    }

    fn clear(&mut self, issuer: &str, scope: &str) -> io::Result<()> {
        let path = self.path(issuer, scope)?;
        match fs::remove_file(&path) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error),
            Ok(()) => File::open(parent(&path)?)?.sync_all(),
        }
    }
}

/// Markers of a session with no RUNTIME root (the self-test and in-process tests).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct MemoryMarkers {
    markers: BTreeMap<(String, String), PreInputMarker>,
}

impl MarkerStore for MemoryMarkers {
    fn read(&self, issuer: &str, scope: &str) -> MarkerRead {
        self.markers
            .get(&(issuer.to_owned(), scope.to_owned()))
            .map_or(MarkerRead::Absent, |marker| {
                MarkerRead::Found(Box::new(marker.clone()))
            })
    }

    fn create(&mut self, marker: &PreInputMarker) -> io::Result<()> {
        let key = (marker.binding.issuer.clone(), marker.binding.scope.clone());
        if self.markers.contains_key(&key) {
            return Err(io::Error::from(io::ErrorKind::AlreadyExists));
        }
        self.markers.insert(key, marker.clone());
        Ok(())
    }

    fn record_receipt(&mut self, marker: &PreInputMarker) -> io::Result<()> {
        let key = (marker.binding.issuer.clone(), marker.binding.scope.clone());
        self.markers.insert(key, marker.clone());
        Ok(())
    }

    fn clear(&mut self, issuer: &str, scope: &str) -> io::Result<()> {
        self.markers.remove(&(issuer.to_owned(), scope.to_owned()));
        Ok(())
    }
}

/// A plain file-name component: 1-64 of `[A-Za-z0-9._-]`, never `.` or `..`.
pub(crate) fn component(name: &str) -> io::Result<&str> {
    let plain = !name.is_empty()
        && name.len() <= 64
        && name != "."
        && name != ".."
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'));
    if plain {
        Ok(name)
    } else {
        Err(io::Error::other(
            "a marker key is not a plain path component",
        ))
    }
}

/// No marker can be there: the file or a directory on its path is missing, or a path
/// component is not a directory (then no marker can be persisted either).
fn no_such_marker(error: &io::Error) -> bool {
    #[cfg(unix)]
    let not_a_dir = error.raw_os_error() == Some(libc::ENOTDIR);
    #[cfg(not(unix))]
    let not_a_dir = false;
    error.kind() == io::ErrorKind::NotFound || not_a_dir
}

fn parent(path: &Path) -> io::Result<&Path> {
    path.parent()
        .ok_or_else(|| io::Error::other("the marker path has no directory"))
}

fn write_new(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    no_follow_private(&mut options);
    let mut file = options.open(path)?;
    let written = file.write_all(bytes).and_then(|()| file.sync_all());
    if written.is_err() {
        let _ = fs::remove_file(path);
    }
    written
}

#[cfg(unix)]
fn no_follow_private(options: &mut OpenOptions) {
    use std::os::unix::fs::OpenOptionsExt;
    options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
}

#[cfg(not(unix))]
const fn no_follow_private(_options: &mut OpenOptions) {}

fn open_no_follow(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    options.open(path)
}

/// Creates `dir` 0700 and checks it is a real directory this uid owns.
pub(crate) fn private_dir(dir: &Path) -> io::Result<()> {
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(dir)?;
    let meta = fs::symlink_metadata(dir)?;
    if !meta.is_dir() {
        return Err(io::Error::other("not a directory"));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if meta.uid() != euid() {
            return Err(io::Error::other("the directory has another owner"));
        }
    }
    Ok(())
}

#[cfg(unix)]
fn owner_ok(file: &File) -> bool {
    use std::os::unix::fs::MetadataExt;
    file.metadata()
        .is_ok_and(|meta| meta.uid() == euid() && meta.mode() & 0o077 == 0)
}

#[cfg(not(unix))]
fn owner_ok(_file: &File) -> bool {
    true
}

#[cfg(unix)]
fn euid() -> u32 {
    // SAFETY: geteuid has no preconditions and cannot fail.
    unsafe { libc::geteuid() }
}
