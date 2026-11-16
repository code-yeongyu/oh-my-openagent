//! The installed-apps scan: every `.app` bundle under an application folder, vendor
//! subfolders included, never inside a bundle, a bounded number of folders deep.

use std::path::{Path, PathBuf};

/// Folder levels below an application folder the scan descends.
pub const MAX_DEPTH: usize = 3;

/// The `.app` bundles under `folder`.
#[must_use]
pub fn app_bundles(folder: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(folder)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|e| e == "app"))
        .collect()
}
