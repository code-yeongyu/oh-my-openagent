use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::time::{Duration, UNIX_EPOCH};

use senpi_desktop_core::types::ScreenshotGc;

use super::{sweep, ArtifactGc, ARTIFACT_PREFIX};

const NOW: u64 = 10_000_000_000;
const STALE_MS: u64 = 1_000;

fn touch(path: &Path, unix_ms: u64) {
    let dest = UNIX_EPOCH + Duration::from_millis(unix_ms);
    File::options()
        .create(true)
        .write(true)
        .truncate(true)
        .open(path)
        .expect("open")
        .set_modified(dest)
        .expect("mtime");
}

fn exists(path: &Path) -> bool {
    path.symlink_metadata().is_ok()
}

fn png(dir: &Path, name: &str, age_ms: u64) -> PathBuf {
    let path = dir.join(name);
    touch(&path, NOW.saturating_sub(age_ms));
    path
}

#[test]
fn gc_removes_old_matching_pngs() {
    // Given
    let dir = tempfile::tempdir().expect("tempdir");
    let old = png(dir.path(), &format!("{ARTIFACT_PREFIX}old.png"), 5_000);
    // When
    let result = sweep(dir.path(), NOW, STALE_MS);
    // Then
    assert_eq!((result.scanned, result.removed), (1, 1));
    assert!(!exists(&old));
}

#[test]
fn gc_keeps_recent_matching_pngs() {
    // Given
    let dir = tempfile::tempdir().expect("tempdir");
    let recent = png(dir.path(), &format!("{ARTIFACT_PREFIX}recent.png"), 100);
    // When
    let result = sweep(dir.path(), NOW, STALE_MS);
    // Then
    assert_eq!(result.removed, 0);
    assert!(exists(&recent));
}

#[test]
fn gc_keeps_foreign_files() {
    // Given
    let dir = tempfile::tempdir().expect("tempdir");
    let old_match = png(dir.path(), &format!("{ARTIFACT_PREFIX}old.png"), 5_000);
    let recent = png(dir.path(), &format!("{ARTIFACT_PREFIX}recent.png"), 100);
    let foreign_old = png(dir.path(), "notes.txt", 5_000);
    let foreign_png = png(dir.path(), "other.png", 5_000);
    let foreign_jpg = png(dir.path(), &format!("{ARTIFACT_PREFIX}old.jpg"), 5_000);
    // When
    let result = sweep(dir.path(), NOW, STALE_MS);
    // Then
    assert_eq!((result.scanned, result.removed), (2, 1));
    assert!(!exists(&old_match));
    assert!(exists(&recent));
    assert!(exists(&foreign_old));
    assert!(exists(&foreign_png));
    assert!(exists(&foreign_jpg));
}

#[test]
fn gc_uses_injected_clock_to_decide_staleness() {
    // Given: the same file is recent at NOW and stale 5s later.
    let dir = tempfile::tempdir().expect("tempdir");
    let path = png(dir.path(), &format!("{ARTIFACT_PREFIX}clock.png"), 100);
    // When / Then: injected now keeps it.
    assert_eq!(sweep(dir.path(), NOW, STALE_MS).removed, 0);
    assert!(exists(&path));
    // When / Then: advancing the injected clock past stale_ms removes it.
    // Age at NOW+5_000 is 5_100, which is older than 1_000.
    assert_eq!(sweep(dir.path(), NOW + 5_000, STALE_MS).removed, 1);
    assert!(!exists(&path));
}

#[test]
fn gc_skips_a_scan_until_the_interval_elapses() {
    // Given
    let dir = tempfile::tempdir().expect("tempdir");
    let mut gc = ArtifactGc::default();
    let knobs = ScreenshotGc {
        stale_ms: STALE_MS,
        scan_interval_ms: 5_000,
    };
    let old = png(dir.path(), &format!("{ARTIFACT_PREFIX}old.png"), 5_000);
    assert_eq!(gc.maybe_run(dir.path(), NOW, knobs).removed, 1);
    assert!(!exists(&old));
    touch(&old, NOW - 5_000);
    // When: clock has not advanced by scan_interval_ms
    let skipped = gc.maybe_run(dir.path(), NOW + 100, knobs);
    // Then
    assert_eq!(skipped, super::Sweep::default());
    assert!(exists(&old));
    // When: interval elapsed
    assert_eq!(gc.maybe_run(dir.path(), NOW + 5_000, knobs).removed, 1);
    assert!(!exists(&old));
}

#[test]
fn gc_missing_dir_is_a_silent_noop() {
    // Given
    let dir = tempfile::tempdir().expect("tempdir");
    let missing = dir.path().join("does-not-exist");
    // When
    let result = sweep(&missing, NOW, STALE_MS);
    // Then
    assert_eq!(result, super::Sweep::default());
}

#[test]
fn gc_ignores_directories_even_with_the_artifact_name() {
    // Given
    let dir = tempfile::tempdir().expect("tempdir");
    let nested = dir.path().join(format!("{ARTIFACT_PREFIX}dir.png"));
    fs::create_dir(&nested).expect("dir");
    // When
    let result = sweep(dir.path(), NOW, STALE_MS);
    // Then
    assert_eq!(result.removed, 0);
    assert!(exists(&nested));
}
