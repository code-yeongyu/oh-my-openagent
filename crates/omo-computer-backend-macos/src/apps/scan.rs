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

#[cfg(test)]
mod tests {
    #[test]
    fn installed_scan_finds_nested_bundles_but_never_inside_one() {
        let root = std::env::temp_dir().join(format!("omo-apps-scan-{}", std::process::id()));
        let make = |rel: &str| std::fs::create_dir_all(root.join(rel)).expect("mkdir");
        make("Top.app/Contents/Helpers/Inner.app");
        make("Utilities/Tool.app");
        make("Vendor/Suite/Editor.app");
        make("a/b/c/d/TooDeep.app");
        let mut found: Vec<String> = super::app_bundles(&root)
            .iter()
            .filter_map(|p| p.strip_prefix(&root).ok())
            .map(|p| p.display().to_string())
            .collect();
        found.sort();
        std::fs::remove_dir_all(&root).expect("cleanup");
        assert_eq!(
            found,
            vec!["Top.app", "Utilities/Tool.app", "Vendor/Suite/Editor.app"],
            "vendor subfolders are scanned; a bundle's own helpers and anything past the depth are not"
        );
    }
}
