use super::{foreign, names, seed, HOUR};
use crate::audit::gc::{artifact_name, ArtifactStore, GcLimits, SweepTrigger, SWEEP_INTERVAL_MS};

#[test]
fn artifact_gc_caps_and_release_by_digest() {
    let now = crate::audit::now_ms();
    let dir = tempfile::tempdir().expect("tempdir");
    for index in 0..8_u64 {
        seed(
            dir.path(),
            &artifact_name(&format!("d{index}"), "png"),
            100,
            now - 1_000 + index,
        );
    }
    foreign(dir.path(), now);
    let mut store = ArtifactStore::new(
        dir.path().to_owned(),
        GcLimits {
            stale_ms: HOUR,
            max_bytes: 10_000,
            max_files: 5,
        },
    );
    let report = store.sweep(now, SweepTrigger::CapCrossing);
    assert_eq!(
        (report.removed, report.files),
        (4, 4),
        "oldest first down to 80 % of the file cap"
    );
    assert!(
        !dir.path().join(artifact_name("d0", "png")).exists()
            && dir.path().join(artifact_name("d7", "png")).exists()
    );
    assert_eq!(
        names(dir.path()).len(),
        4 + 5,
        "the five foreign files are untouched"
    );
    assert!(store.release("d7"), "release deletes the fetched artifact");
    assert!(
        !store.release("d7"),
        "a second release of the digest is a no-op"
    );
    assert!(!dir.path().join(artifact_name("d7", "png")).exists());
}

#[test]
fn artifact_cap_sweep_to_80pct_never_touches_foreign() {
    let now = crate::audit::now_ms();
    let dir = tempfile::tempdir().expect("tempdir");
    for index in 0..10_u64 {
        seed(
            dir.path(),
            &artifact_name(&format!("f{index}"), "png"),
            100,
            now - 100 + index,
        );
    }
    foreign(dir.path(), now);
    let mut store = ArtifactStore::new(
        dir.path().to_owned(),
        GcLimits {
            stale_ms: 12 * HOUR,
            max_bytes: 1_000,
            max_files: 2_000,
        },
    );
    store
        .record("f10", "png", &[1_u8; 100], now)
        .expect("the capture is written");
    let (bytes, files) = store.usage();
    assert!(bytes <= 800, "under 80 % of the byte cap: {bytes}");
    assert_eq!(files, 8);
    assert_eq!(
        store.sweeps().last().map(|sweep| sweep.trigger),
        Some(SweepTrigger::CapCrossing)
    );
    assert!(
        dir.path().join(artifact_name("f10", "png")).exists(),
        "the new capture is the newest"
    );
    assert_eq!(
        names(dir.path())
            .iter()
            .filter(|name| !name.starts_with("senpi-computer-f"))
            .count(),
        5
    );
}

#[test]
fn artifact_release_by_digest_idempotent() {
    let now = crate::audit::now_ms();
    let dir = tempfile::tempdir().expect("tempdir");
    let mut store = ArtifactStore::new(dir.path().to_owned(), GcLimits::default());
    let path = store.record("abc", "jpg", b"frame", now).expect("written");
    assert!(path.exists());
    assert!(store.release("abc"));
    assert!(!path.exists());
    assert!(!store.release("abc"));
    assert!(!store.release("never-written"));
}

#[test]
fn artifact_sweep_triggers_open_idle_cap_plus_timer() {
    let now = crate::audit::now_ms();
    let dir = tempfile::tempdir().expect("tempdir");
    let mut store = ArtifactStore::new(
        dir.path().to_owned(),
        GcLimits {
            stale_ms: HOUR,
            max_bytes: 100,
            max_files: 2_000,
        },
    );
    store.sweep(now, SweepTrigger::Open);
    assert_eq!(store.tick(now), None, "the first tick arms the timer");
    assert_eq!(store.tick(now + SWEEP_INTERVAL_MS - 1), None);
    store
        .record("big", "png", &[0_u8; 200], now + 10)
        .expect("written");
    assert!(
        store.tick(now + SWEEP_INTERVAL_MS).is_some(),
        "the 1,800,000 ms timer sweep on the fake clock"
    );
    store.sweep(now + SWEEP_INTERVAL_MS + 1, SweepTrigger::IdleExit);
    let triggers: Vec<SweepTrigger> = store.sweeps().iter().map(|sweep| sweep.trigger).collect();
    assert_eq!(
        triggers,
        vec![
            SweepTrigger::Open,
            SweepTrigger::CapCrossing,
            SweepTrigger::Timer,
            SweepTrigger::IdleExit
        ]
    );
}
