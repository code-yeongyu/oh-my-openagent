use std::fs::{self, File};
use std::time::{Duration, UNIX_EPOCH};

use super::{foreign, names, seed, HOUR};
use crate::audit::gc::{artifact_name, ArtifactStore, GcLimits, SweepTrigger};

#[test]
fn artifact_gc_200_stale_20_fresh_5_foreign() {
    let now = crate::audit::now_ms();
    let dir = tempfile::tempdir().expect("tempdir");
    for index in 0..200_u64 {
        seed(
            dir.path(),
            &artifact_name(
                &format!("s{index}"),
                if index % 2 == 0 { "png" } else { "jpg" },
            ),
            10,
            now - 13 * HOUR - index,
        );
    }
    for index in 0..20_u64 {
        seed(
            dir.path(),
            &artifact_name(&format!("f{index}"), "png"),
            10,
            now - HOUR + index,
        );
    }
    foreign(dir.path(), now);
    let mut store = ArtifactStore::new(dir.path().to_owned(), GcLimits::default());
    let report = store.sweep(now, SweepTrigger::Open);
    assert_eq!(
        report.removed, 200,
        "exactly the 200 stale prefixed artifacts"
    );
    assert_eq!(
        names(dir.path()).len(),
        25,
        "the 20 fresh and the 5 foreign stay"
    );
}

#[test]
fn artifact_sweep_of_a_missing_dir_is_a_silent_noop_and_ignores_named_dirs() {
    let now = crate::audit::now_ms();
    let dir = tempfile::tempdir().expect("tempdir");
    let mut missing = ArtifactStore::new(dir.path().join("absent"), GcLimits::default());
    let report = missing.sweep(now, SweepTrigger::Open);
    assert_eq!(
        (report.removed, report.files, report.warnings.len()),
        (0, 0, 0)
    );
    fs::create_dir(dir.path().join(artifact_name("dir", "png")))
        .expect("a dir with an artifact's name");
    let mut store = ArtifactStore::new(
        dir.path().to_owned(),
        GcLimits {
            stale_ms: 0,
            max_bytes: 1,
            max_files: 1,
        },
    );
    store.sweep(now + 13 * HOUR, SweepTrigger::Timer);
    assert!(
        dir.path().join(artifact_name("dir", "png")).is_dir(),
        "a directory is never an artifact"
    );
}

#[test]
fn artifact_ac33_capture_leaves_one_file_that_the_first_sweep_after_stale_ms_removes() {
    let now = crate::audit::now_ms();
    let dir = tempfile::tempdir().expect("tempdir");
    let mut store = ArtifactStore::new(dir.path().to_owned(), GcLimits::default());
    let frame = vec![0_u8; 3840 * 2400 / 64];
    let path = store
        .record("ac33-capture", "png", &frame, now)
        .expect("the capture's artifact");
    File::options()
        .write(true)
        .open(&path)
        .expect("open")
        .set_modified(UNIX_EPOCH + Duration::from_millis(now))
        .expect("mtime");
    assert_eq!(store.usage().1, 1, "exactly one prefixed file");
    assert_eq!(
        store
            .sweep(now + GcLimits::default().stale_ms, SweepTrigger::Timer)
            .removed,
        0,
        "not before stale_ms"
    );
    assert_eq!(
        store
            .sweep(now + GcLimits::default().stale_ms + 1, SweepTrigger::Timer)
            .removed,
        1
    );
    assert!(!path.exists());
}
#[cfg(unix)]
#[test]
fn artifact_sweep_io_error_warns_capture_succeeds() {
    let now = crate::audit::now_ms();
    let dir = tempfile::tempdir().expect("tempdir");
    let session = dir.path().join(crate::audit::gc::SESSIONS_DIR).join("s-1");
    fs::create_dir_all(session.join("turn-00001")).expect("session dir");
    seed(
        &session.join("turn-00001"),
        "frame.png",
        10,
        now - 13 * HOUR,
    );
    File::options()
        .write(true)
        .open(session.join("turn-00001/frame.png"))
        .expect("open")
        .set_modified(UNIX_EPOCH + Duration::from_millis(now - 13 * HOUR))
        .expect("mtime");
    File::open(&session)
        .expect("dir")
        .set_modified(UNIX_EPOCH + Duration::from_millis(now - 13 * HOUR))
        .expect("dir mtime");
    fs::set_permissions(
        session.join("turn-00001"),
        std::os::unix::fs::PermissionsExt::from_mode(0o500),
    )
    .expect("read-only");
    let mut store = ArtifactStore::new(
        dir.path().to_owned(),
        GcLimits {
            stale_ms: HOUR,
            max_bytes: 105,
            max_files: 2_000,
        },
    );
    let captured = store.record("capture", "png", &[0_u8; 100], now);
    fs::set_permissions(
        session.join("turn-00001"),
        std::os::unix::fs::PermissionsExt::from_mode(0o700),
    )
    .expect("restore");
    assert!(
        captured.is_ok(),
        "the capture that triggered the sweep still succeeds"
    );
    let sweep = store
        .sweeps()
        .last()
        .expect("a cap-crossing sweep ran")
        .clone();
    assert_eq!(
        sweep.warnings.len(),
        1,
        "one warn line: {:?}",
        sweep.warnings
    );
}
