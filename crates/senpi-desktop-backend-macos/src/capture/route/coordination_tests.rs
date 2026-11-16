//! Capture-lock coordination with real helper deadlines.

use std::time::Duration;

use senpi_desktop_core::error::CoreResult;
use senpi_desktop_core::types::Target;

use super::{capture, override_availability, ReasonsGuard};
use crate::capture::sck;

/// A helper script with `signal()` (wakes the test once) and `ready()`
/// (answers the warm-up ping), then `body`.
fn signalling_helper(dir: &tempfile::TempDir, fifo: &std::path::Path, body: &str) -> std::path::PathBuf {
    let script = format!(
        "#!/usr/bin/env python3\nimport json, sys, time\n\
         def signal():\n    open(r'{}', 'w').close()\n\
         def ready():\n    sys.stdin.readline()\n    sys.stdout.write(json.dumps({{'kind': 'ready'}}) + '\\n')\n    sys.stdout.flush()\n\
         {body}\n",
        fifo.display()
    );
    sck::test_support::fake_helper(dir, &script)
}

/// Runs one capture on its own session thread with `helper` and a private lock.
fn capture_on_session_thread(
    helper: std::path::PathBuf,
    lock: std::path::PathBuf,
    warm: Duration,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        sck::TEST_WARM_TIMEOUT.set(Some(warm));
        let _reasons = ReasonsGuard::new();
        override_availability(Some(Ok(())));
        crate::capture::TEST_LOCK_PATH.with_borrow_mut(|path| *path = Some(lock));
        let _program = sck::test_support::ProgramGuard::new(helper);
        let _ = capture().capture_with_exclusions(&Target::Window("42".to_owned()), &[]);
        override_availability(None);
    })
}

/// Another session's capture: the same lock, its normal wait, no pixels.
fn concurrent_capture(lock: &std::path::Path) -> CoreResult<()> {
    crate::overlay::Overlay::default().capture(lock, || Ok(Vec::new()), std::thread::sleep, |_excluded| Ok(()))
}

#[test]
fn a_stalled_helper_start_does_not_hold_the_capture_lock() {
    // Given: a session whose helper starts and never answers its warm-up ping
    let dir = tempfile::tempdir().unwrap();
    let lock = dir.path().join("capture.lock");
    let (fifo, signalled) = sck::test_support::startup_signal(&dir);
    let helper = signalling_helper(&dir, &fifo, "signal()\ntime.sleep(30)");
    // The warm-up budget must outlast the fake helper's interpreter start on a loaded host
    // (over 1 s at load ~180), or the helper is killed before it signals.
    let session = capture_on_session_thread(helper, lock.clone(), Duration::from_secs(8));
    signalled.recv_timeout(Duration::from_secs(10)).expect("helper started");
    // When: another session captures while that helper is still starting
    let other = concurrent_capture(&lock);
    // Then: it gets the lock instead of failing
    assert!(other.is_ok(), "{other:?}");
    session.join().unwrap();
}

#[test]
fn a_stalled_capture_under_the_lock_lets_a_concurrent_capture_through() {
    // Given: a warm helper that stalls without returning a capture reply
    let dir = tempfile::tempdir().unwrap();
    let lock = dir.path().join("capture.lock");
    let helper = sck::test_support::fake_helper(
        &dir,
        r#"#!/usr/bin/env python3
import json, sys
assert json.loads(sys.stdin.readline()) == {'kind': 'ping'}
sys.stdout.write(json.dumps({'kind': 'ready'}) + '\n')
sys.stdout.flush()
sys.stdin.read()
"#,
    );
    let (started, signalled) = std::sync::mpsc::channel();
    let capture_lock = lock.clone();
    let session = std::thread::spawn(move || {
        let _reasons = ReasonsGuard::new();
        let _program = sck::test_support::ProgramGuard::new(helper);
        sck::SckWorker::prepare().unwrap();
        // Keep the actual worker budget and lock, without WindowServer queries
        // or a second legacy-fallback lock acquisition in this deadline test.
        let result = crate::overlay::Overlay::default().capture(
            &capture_lock,
            || Ok(Vec::new()),
            std::thread::sleep,
            |excluded| {
                started.send(()).unwrap();
                capture().capture_via_sck(&Target::Window("42".to_owned()), &[], excluded)
            },
        );
        assert!(matches!(result, Ok(None)), "{result:?}");
    });
    signalled.recv_timeout(Duration::from_secs(40)).expect("capture holds the lock");
    // When: another session captures while the stalled capture holds the lock
    let other = concurrent_capture(&lock);
    // Then: the in-lock budget ends the stall inside the other session's wait
    assert!(other.is_ok(), "{other:?}");
    session.join().unwrap();
}
