//! The prefixed entries of the artifact dir and their removal.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Entry {
    pub(super) path: PathBuf,
    pub(super) bytes: u64,
    pub(super) modified_ms: u64,
    pub(super) dir: bool,
}

pub(super) fn list(dir: &Path, warnings: &mut Vec<String>) -> Vec<PathBuf> {
    match fs::read_dir(dir) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Vec::new(),
        Err(error) => {
            warnings.push(format!("{}: {error}", dir.display()));
            Vec::new()
        }
        Ok(read) => read
            .filter_map(|entry| match entry {
                Ok(entry) => Some(entry.path()),
                Err(error) => {
                    warnings.push(format!("{}: {error}", dir.display()));
                    None
                }
            })
            .collect(),
    }
}

fn modified_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |since| {
            u64::try_from(since.as_millis()).unwrap_or(u64::MAX)
        })
}

pub(super) fn file_entry(path: &Path, warnings: &mut Vec<String>) -> Option<Entry> {
    match fs::metadata(path) {
        Err(error) => {
            warnings.push(format!("{}: {error}", path.display()));
            None
        }
        Ok(meta) => Some(Entry {
            path: path.to_owned(),
            bytes: meta.len(),
            modified_ms: modified_ms(&meta),
            dir: false,
        }),
    }
}

/// A trace session dir: its bytes summed, its age the newest file's. A child that cannot be
/// read is a warning (its size and age are then missing from the sum, never silently).
pub(super) fn dir_entry(path: PathBuf, warnings: &mut Vec<String>) -> Entry {
    let (mut bytes, mut newest) = (0, fs::metadata(&path).map_or(0, |meta| modified_ms(&meta)));
    let mut stack = vec![path.clone()];
    while let Some(dir) = stack.pop() {
        let children = match fs::read_dir(&dir) {
            Ok(children) => children,
            Err(error) => {
                warnings.push(format!("{}: {error}", dir.display()));
                continue;
            }
        };
        for child in children {
            match child.and_then(|child| child.metadata().map(|meta| (child.path(), meta))) {
                Err(error) => warnings.push(format!("{}: {error}", dir.display())),
                Ok((child, meta)) if meta.is_dir() => stack.push(child),
                Ok((_, meta)) => {
                    bytes += meta.len();
                    newest = newest.max(modified_ms(&meta));
                }
            }
        }
    }
    Entry {
        path,
        bytes,
        modified_ms: newest,
        dir: true,
    }
}

pub(super) fn remove(entry: &Entry, warnings: &mut Vec<String>, removed: &mut u64) -> bool {
    let result = if entry.dir {
        fs::remove_dir_all(&entry.path)
    } else {
        fs::remove_file(&entry.path)
    };
    match result {
        Ok(()) => {
            *removed += 1;
            true
        }
        Err(error) => {
            warnings.push(format!("{}: {error}", entry.path.display()));
            false
        }
    }
}
