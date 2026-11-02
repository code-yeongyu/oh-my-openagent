//! Append-only audit JSONL. Errors go to stderr and never fail the action.
//! Rotates the file at 50 MiB to `*.1.jsonl`. New files are mode 0o600.

use std::fs::OpenOptions;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use super::{warn, AuditRecord};

/// Rotate when the live file reaches this size.
pub(crate) const ROTATE_BYTES: u64 = 50 * 1024 * 1024;

pub(crate) fn append(path: &Path, record: &AuditRecord) {
    append_rotating(path, record, ROTATE_BYTES);
}

pub(crate) fn append_rotating(path: &Path, record: &AuditRecord, rotate_bytes: u64) {
    if let Err(error) = try_append(path, record, rotate_bytes) {
        warn(format_args!(
            "audit log write failed ({}): {error}",
            path.display()
        ));
    }
}

fn try_append(path: &Path, record: &AuditRecord, rotate_bytes: u64) -> io::Result<()> {
    rotate_if_needed(path, rotate_bytes);
    let mut options = OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    let line =
        serde_json::to_string(record).map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    file.write_all(line.as_bytes())?;
    file.write_all(b"\n")?;
    Ok(())
}

fn rotate_if_needed(path: &Path, rotate_bytes: u64) {
    let Ok(meta) = path.metadata() else {
        return;
    };
    if meta.len() < rotate_bytes {
        return;
    }
    let rotated = rotated_path(path);
    if let Err(error) = std::fs::rename(path, &rotated) {
        warn(format_args!(
            "audit log rotate failed ({}): {error}",
            path.display()
        ));
    }
}

fn rotated_path(path: &Path) -> PathBuf {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return path.join("rotated.1");
    };
    match name.rsplit_once('.') {
        Some((stem, ext)) => path.with_file_name(format!("{stem}.1.{ext}")),
        None => path.with_file_name(format!("{name}.1")),
    }
}

#[cfg(test)]
#[path = "writer_test.rs"]
mod tests;
