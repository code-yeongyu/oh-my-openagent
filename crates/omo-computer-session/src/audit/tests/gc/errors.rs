//! Gate review a5 / planner R10: an artifact the GC cannot delete is a warning, never a
//! silent "not released", and the GC goes on with the next entry. Triggered without
//! permissions, so it holds as root too: a DIRECTORY where the artifact's file goes makes
//! the delete fail (EISDIR on Linux, EPERM on macOS, access denied on Windows).
//!
//! The failure is LOGGED once, by release() when it happens (stderr is not observable from
//! a test); the sweep logs only its own new warnings. The REPORT is the observable record:
//! the next sweep's warnings carry it exactly once, as asserted below.

use std::fs;

use super::{seed, HOUR};
use crate::audit::gc::{artifact_name, ArtifactStore, GcLimits, SweepTrigger};

#[test]
fn an_artifact_that_cannot_be_deleted_is_a_sweep_warning_and_the_gc_goes_on() {
    let now = crate::audit::now_ms();
    let dir = tempfile::tempdir().expect("tempdir");
    let blocked = artifact_name("d1", "png");
    fs::create_dir(dir.path().join(&blocked)).expect("a directory where the artifact goes");
    seed(dir.path(), &artifact_name("d1", "jpg"), 10, now);
    seed(
        dir.path(),
        &artifact_name("stale", "png"),
        10,
        now - 13 * HOUR,
    );
    let mut store = ArtifactStore::new(dir.path().to_owned(), GcLimits::default());
    assert!(
        store.release("d1"),
        "the .jpg of d1 is released past the .png that cannot be"
    );
    assert!(!dir.path().join(artifact_name("d1", "jpg")).exists());
    let report = store.sweep(now, SweepTrigger::Timer);
    let warned = report
        .warnings
        .iter()
        .filter(|line| line.contains(&blocked))
        .count();
    assert_eq!(
        warned, 1,
        "the failed delete is a warning: {:?}",
        report.warnings
    );
    assert_eq!(
        report.removed, 1,
        "the next, valid stale entry is still removed"
    );
    assert!(!dir.path().join(artifact_name("stale", "png")).exists());
    assert!(
        dir.path().join(&blocked).is_dir(),
        "nothing foreign is removed"
    );
}
