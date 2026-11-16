//! The `.desktop` files of `XDG_DATA_HOME` and `XDG_DATA_DIRS`, in XDG precedence order.

use std::path::{Path, PathBuf};

fn data_dirs() -> Vec<PathBuf> {
    let home = std::env::var("XDG_DATA_HOME")
        .ok()
        .filter(|dir| !dir.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var("HOME")
                .ok()
                .map(|home| Path::new(&home).join(".local/share"))
        });
    let dirs = std::env::var("XDG_DATA_DIRS")
        .ok()
        .filter(|dirs| !dirs.is_empty())
        .unwrap_or_else(|| "/usr/local/share:/usr/share".to_owned());
    home.into_iter()
        .chain(
            dirs.split(':')
                .filter(|dir| !dir.is_empty())
                .map(PathBuf::from),
        )
        .collect()
}

fn collect(dir: &Path, depth: u32, out: &mut Vec<(PathBuf, String)>) {
    let Ok(read) = std::fs::read_dir(dir) else {
        return;
    };
    let mut paths: Vec<PathBuf> = read.flatten().map(|entry| entry.path()).collect();
    paths.sort();
    for path in paths {
        if path.is_dir() && depth > 0 {
            collect(&path, depth - 1, out);
        } else if path.extension().is_some_and(|ext| ext == "desktop") {
            if let Ok(contents) = std::fs::read_to_string(&path) {
                out.push((path, contents));
            }
        }
    }
}

/// Every desktop file, highest precedence first.
#[must_use]
pub fn desktop_files() -> Vec<(PathBuf, String)> {
    let mut out = Vec::new();
    for dir in data_dirs() {
        collect(&dir.join("applications"), 2, &mut out);
    }
    out
}
