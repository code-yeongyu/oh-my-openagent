//! Artifact retention: shared seeding helpers.

mod age;
mod cap;

use std::fs::{self, File};
use std::path::Path;
use std::time::{Duration, UNIX_EPOCH};

pub(super) const HOUR: u64 = 3_600_000;

pub(super) fn seed(dir: &Path, name: &str, bytes: usize, modified_ms: u64) {
    fs::write(dir.join(name), vec![7_u8; bytes]).expect("seed");
    let file = File::options()
        .write(true)
        .open(dir.join(name))
        .expect("open");
    file.set_modified(UNIX_EPOCH + Duration::from_millis(modified_ms))
        .expect("mtime");
}

pub(super) fn names(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .expect("dir")
        .filter_map(Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

pub(super) fn foreign(dir: &Path, now: u64) {
    for (index, name) in [
        "notes.txt",
        "other-1.png",
        "senpi-computer-x.gif",
        "senpi-computer-y.txt",
        "screenshot.jpg",
    ]
    .iter()
    .enumerate()
    {
        seed(dir, name, 10, now - 100 * HOUR + index as u64);
    }
}
