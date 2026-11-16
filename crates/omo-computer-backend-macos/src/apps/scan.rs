//! The installed-apps scan: every `.app` bundle under an application folder, vendor
//! subfolders included, never inside a bundle, a bounded number of folders deep.

use std::path::{Path, PathBuf};

/// Folder levels below an application folder the scan descends.
pub const MAX_DEPTH: usize = 3;

/// The `.app` bundles under `folder`.
#[must_use]
pub fn app_bundles(folder: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    scan(folder, 0, &mut out);
    out
}

fn scan(folder: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(folder) else {
        return;
    };
    for path in entries.filter_map(Result::ok).map(|entry| entry.path()) {
        if path.extension().is_some_and(|e| e == "app") {
            out.push(path);
        } else if depth < MAX_DEPTH && path.is_dir() {
            scan(&path, depth + 1, out);
        }
    }
}
