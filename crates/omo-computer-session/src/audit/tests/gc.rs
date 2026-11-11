use std::fs::{self, File};
use std::path::Path;
use std::time::{Duration, UNIX_EPOCH};

use crate::audit::gc::{artifact_name, ArtifactStore, GcLimits, SweepTrigger};

const HOUR: u64 = 3_600_000;

fn seed(dir: &Path, name: &str, bytes: usize, modified_ms: u64) {
    fs::write(dir.join(name), vec![7_u8; bytes]).expect("seed");
    let file = File::options().write(true).open(dir.join(name)).expect("open");
    file.set_modified(UNIX_EPOCH + Duration::from_millis(modified_ms)).expect("mtime");
}

fn names(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .expect("dir")
        .filter_map(Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

fn foreign(dir: &Path, now: u64) {
    for (index, name) in ["notes.txt", "other-1.png", "senpi-computer-x.gif", "senpi-computer-y.txt", "screenshot.jpg"].iter().enumerate() {
        seed(dir, name, 10, now - 100 * HOUR + index as u64);
    }
}

#[test]
fn artifact_gc_caps_and_release_by_digest() {
    let now = crate::audit::now_ms();
    let dir = tempfile::tempdir().expect("tempdir");
    for index in 0..8_u64 {
        seed(dir.path(), &artifact_name(&format!("d{index}"), "png"), 100, now - 1_000 + index);
    }
    foreign(dir.path(), now);
    let mut store = ArtifactStore::new(dir.path().to_owned(), GcLimits { stale_ms: HOUR, max_bytes: 10_000, max_files: 5 });
    let report = store.sweep(now, SweepTrigger::CapCrossing);
    assert_eq!((report.removed, report.files), (4, 4), "oldest first down to 80 % of the file cap");
    assert!(!dir.path().join(artifact_name("d0", "png")).exists() && dir.path().join(artifact_name("d7", "png")).exists());
    assert_eq!(names(dir.path()).len(), 4 + 5, "the five foreign files are untouched");
    assert!(store.release("d7"), "release deletes the fetched artifact");
    assert!(!store.release("d7"), "a second release of the digest is a no-op");
    assert!(!dir.path().join(artifact_name("d7", "png")).exists());
}

