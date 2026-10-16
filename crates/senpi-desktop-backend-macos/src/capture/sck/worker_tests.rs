//! Restart regressions through the real session-thread worker and child pipes.

use super::test_support::{fake_helper, ProgramGuard, PY_PREAMBLE};
use super::{target_window, SckCaptureError, SckWorker};

fn capture_after_transport_failure(first_reply: &str, started: bool) {
    let dir = tempfile::tempdir().unwrap();
    let helper = fake_helper(
        &dir,
        &format!(
            "{PY_PREAMBLE}
import os, pathlib

marker = pathlib.Path(__file__).with_suffix('.started')
first_start = not marker.exists()
marker.touch()
if first_start and {die_on_ping}:
    sys.stdin.buffer.readline()
    os._exit(1)
read_request()
if first_start:
{first_reply}
    os._exit(1)
header({{
    'kind': 'frame', 'index': 0, 'width': 1, 'height': 1, 'byteLength': 4,
    'bounds': {{'x': 0.0, 'y': 0.0, 'width': 1.0, 'height': 1.0}}
}})
pixels(1, 1, [56, 34, 12, 255])
",
            die_on_ping = if started { "False" } else { "True" },
        ),
    );
    let _program = ProgramGuard::new(helper);
    let requests = [target_window(42)];
    if started {
        SckWorker::prepare().unwrap();
        let first = SckWorker::capture(&requests);
        assert!(matches!(first, Err(SckCaptureError::Failed(_))), "{first:?}");
    } else {
        // A helper that dies before any reply byte fails its warm-up: a start failure.
        assert!(SckWorker::prepare().is_err());
        let unstarted = SckWorker::capture(&requests);
        assert!(matches!(unstarted, Err(SckCaptureError::Start(_))), "{unstarted:?}");
    }
    SckWorker::prepare().unwrap();
    let frames = SckWorker::capture(&requests).unwrap();
    assert_eq!(frames.len(), 1);
    assert_eq!(frames[0].image.as_raw(), &[12, 34, 56, 255]);
}

#[test]
fn a_worker_dying_during_its_first_capture_restarts_for_the_next_capture() {
    capture_after_transport_failure(
        "    header({
        'kind': 'frame', 'index': 0, 'width': 2, 'height': 2, 'byteLength': 16,
        'bounds': {'x': 0.0, 'y': 0.0, 'width': 2.0, 'height': 2.0}
    })
    pixels(1, 1, [0, 0, 0, 255])",
        true,
    );
}

#[test]
fn a_helper_dying_before_any_reply_byte_is_a_start_failure() {
    capture_after_transport_failure("    pass", false);
}

#[test]
fn oversized_dimensions_reset_the_worker_before_the_next_capture() {
    capture_after_transport_failure(
        "    header({
        'kind': 'frame', 'index': 0, 'width': 4294967295, 'height': 1, 'byteLength': 4,
        'bounds': {'x': 0.0, 'y': 0.0, 'width': 1.0, 'height': 1.0}
    })
    pixels(1, 1, [0, 0, 0, 255])",
        true,
    );
}

#[test]
fn an_established_worker_death_surfaces_error_and_restarts() {
    let dir = tempfile::tempdir().unwrap();
    let helper = fake_helper(
        &dir,
        &format!(
            "{PY_PREAMBLE}
import os, pathlib

marker = pathlib.Path(__file__).with_suffix('.started')
first_start = not marker.exists()
marker.touch()
read_request()
header({{
    'kind': 'frame', 'index': 0, 'width': 1, 'height': 1, 'byteLength': 4,
    'bounds': {{'x': 0.0, 'y': 0.0, 'width': 1.0, 'height': 1.0}}
}})
pixels(1, 1, [56, 34, 12, 255])
if first_start:
    read_request()
    os._exit(1)
"
        ),
    );
    let _program = ProgramGuard::new(helper);
    let requests = [target_window(42)];
    SckWorker::prepare().unwrap();
    assert_eq!(SckWorker::capture(&requests).unwrap().len(), 1);
    let failure = SckWorker::capture(&requests);
    assert!(matches!(failure, Err(SckCaptureError::Failed(_))), "{failure:?}");
    SckWorker::prepare().unwrap();
    let frames = SckWorker::capture(&requests).unwrap();
    assert_eq!(frames[0].image.as_raw(), &[12, 34, 56, 255]);
}

#[test]
fn the_in_lock_budget_grows_per_target_and_is_capped() {
    use std::time::Duration;
    assert_eq!(super::in_lock_budget(1), Duration::from_millis(2500));
    assert_eq!(super::in_lock_budget(3), Duration::from_millis(3500));
    assert_eq!(super::in_lock_budget(64), super::IN_LOCK_MAX);
}

#[test]
fn a_stalled_warm_up_keeps_the_worker_off_instead_of_retrying_each_capture() {
    // Given: a helper that never answers its ping
    let dir = tempfile::tempdir().unwrap();
    let helper = fake_helper(&dir, &format!("{PY_PREAMBLE}\nimport time\ntime.sleep(30)\n"));
    let _program = ProgramGuard::new(helper);
    super::TEST_WARM_TIMEOUT.set(Some(std::time::Duration::from_millis(500)));
    // When: the first warm-up times out and a second capture warms up again
    let before = super::TEST_STARTS.get();
    assert!(SckWorker::prepare().is_err());
    let again = std::time::Instant::now();
    assert!(SckWorker::prepare().is_err());
    // Then: the second attempt returns at once without starting another helper
    assert!(again.elapsed() < std::time::Duration::from_secs(1));
    assert_eq!(super::TEST_STARTS.get() - before, 1);
    super::WARM_STALLED_UNTIL.set(None);
    super::TEST_WARM_TIMEOUT.set(Some(std::time::Duration::from_secs(30)));
}

#[test]
fn an_in_lock_timeout_keeps_the_worker_off_for_the_next_captures() {
    // Given: a warm helper that stalls on every capture
    let dir = tempfile::tempdir().unwrap();
    let helper = fake_helper(&dir, &format!("{PY_PREAMBLE}\nimport time\nread_request()\ntime.sleep(30)\n"));
    let _program = ProgramGuard::new(helper);
    SckWorker::prepare().unwrap();
    // When: the capture exceeds its in-lock budget
    let timed_out = SckWorker::capture(&[target_window(42)]);
    assert!(matches!(timed_out, Err(SckCaptureError::TimedOut(_))), "{timed_out:?}");
    // Then: the next warm-up is refused at once without starting a helper
    let before = super::TEST_STARTS.get();
    assert!(SckWorker::prepare().is_err());
    assert_eq!(super::TEST_STARTS.get(), before);
    super::WARM_STALLED_UNTIL.set(None);
}
