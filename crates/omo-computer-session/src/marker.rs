//! The pre-input marker: `markers/<issuer>/<scope>.json` under the per-uid RUNTIME root,
//! one outstanding per `(issuer, scope)`. It is created `O_CREAT|O_EXCL` (0600, no symlink
//! followed) and fsynced, file and directory, BEFORE the first OS event of every exec call on
//! every transport; the reply is stored in it as the receipt once the call completes. A file
//! that is there and cannot be read as a marker reads `Unreadable`, never absent.

use std::collections::BTreeMap;
use std::io;
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
    fn read(&self, _issuer: &str, _scope: &str) -> MarkerRead {
        MarkerRead::Absent
    }

    fn create(&mut self, _marker: &PreInputMarker) -> io::Result<()> {
        Ok(())
    }

    fn record_receipt(&mut self, _marker: &PreInputMarker) -> io::Result<()> {
        Ok(())
    }

    fn clear(&mut self, _issuer: &str, _scope: &str) -> io::Result<()> {
        Ok(())
    }
}

/// Markers of a session with no RUNTIME root (the self-test and in-process tests).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct MemoryMarkers {
    markers: BTreeMap<(String, String), PreInputMarker>,
}

impl MarkerStore for MemoryMarkers {
    fn read(&self, _issuer: &str, _scope: &str) -> MarkerRead {
        MarkerRead::Absent
    }

    fn create(&mut self, _marker: &PreInputMarker) -> io::Result<()> {
        Ok(())
    }

    fn record_receipt(&mut self, _marker: &PreInputMarker) -> io::Result<()> {
        Ok(())
    }

    fn clear(&mut self, _issuer: &str, _scope: &str) -> io::Result<()> {
        Ok(())
    }
}

fn component(name: &str) -> io::Result<&str> {
    Ok(name)
}

/// RED stub: creates nothing.
pub(crate) fn private_dir(_dir: &Path) -> io::Result<()> {
    Ok(())
}
