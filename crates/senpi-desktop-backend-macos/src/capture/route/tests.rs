//! Legacy-fallback routing tests: the once-per-reason log, the availability
//! override driving `legacy_capture`, and the SCK start/crash/flag mapping.

use std::cell::RefCell;
use std::sync::atomic::AtomicU8;
use std::time::Duration;

use image::{Rgba, RgbaImage};
use senpi_desktop_core::error::{CoreResult, DesktopError, ErrorCode};
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::types::{DisplaySelector, Target};

use super::super::sck::{
    override_capture, SckCaptureError, SckFrame, SckTargetRequest, SckUnavailable,
};
use super::test_support::{override_availability, ReasonsGuard};
use super::{note_legacy, note_legacy_into, with_legacy_reasons, MacCapture, REASON_START_FAILED};
use crate::capture::minimized::override_probe;
use crate::capture::Screencapture;

fn shooter() -> Screencapture {
    Screencapture::with(
        std::path::PathBuf::from("/usr/bin/true"),
        Duration::from_secs(60),
        || true,
    )
}

fn capture() -> MacCapture {
    MacCapture::new(DisplaySelector::All, shooter())
}

fn sck_frame() -> SckFrame {
    SckFrame {
        image: RgbaImage::from_pixel(4, 2, Rgba([1, 2, 3, 255])),
        bounds: (10.0, 20.0, 40.0, 20.0),
        is_on_screen: Some(false),
        pid: None,
    }
}

fn fake_frames(_requests: &[SckTargetRequest]) -> Result<Vec<SckFrame>, SckCaptureError> {
    Ok(vec![sck_frame()])
}

fn fake_start(_requests: &[SckTargetRequest]) -> Result<Vec<SckFrame>, SckCaptureError> {
    Err(SckCaptureError::Start(DesktopError::capture_failed("start failed")))
}

fn fake_unavailable(_requests: &[SckTargetRequest]) -> Result<Vec<SckFrame>, SckCaptureError> {
    Err(SckCaptureError::Failed(DesktopError::capture_unavailable(
        "minimized",
        "The window is minimized",
    )))
}

#[test]
fn each_reason_logs_exactly_once() {
    let _reasons = ReasonsGuard::new();
    let store = AtomicU8::new(0);
    let lines = RefCell::new(Vec::new());
    let log = |line: &str| lines.borrow_mut().push(line.to_owned());
    for _ in 0..3 {
        note_legacy_into(&store, REASON_START_FAILED, "start failed", log);
    }
    assert_eq!(lines.borrow().as_slice(), &["start failed".to_owned()]);
}

#[test]
fn unsupported_and_missing_helper_report_legacy() {
    let _reasons = ReasonsGuard::new();
    for reason in [
        SckUnavailable::Unsupported,
        SckUnavailable::HelperUnavailable,
    ] {
        override_availability(Some(Err(reason)));
        assert!(capture().legacy_capture(), "{reason:?} must report legacy");
    }
    override_availability(None);
}

#[test]
fn a_start_failure_marks_legacy_after_it_is_noted() {
    let _reasons = ReasonsGuard::new();
    note_legacy(REASON_START_FAILED, "start failed");
    override_availability(Some(Ok(())));
    assert!(capture().legacy_capture());
    override_availability(None);
}

#[test]
fn a_helper_start_failure_falls_back_without_error() {
    let _reasons = ReasonsGuard::new();
    override_availability(Some(Ok(())));
    override_capture(Some(fake_start));
    let result = capture().capture_via_sck(&Target::Window("42".to_owned()), &[], &[]);
    override_capture(None);
    override_availability(None);
    // Ok(None) is the silent-fallback signal: no error reaches the caller.
    assert!(matches!(result, Ok(None)), "{result:?}");
}

fn worker_must_not_run(_requests: &[SckTargetRequest]) -> Result<Vec<SckFrame>, SckCaptureError> {
    panic!("a cursor-helper window must be refused before the worker runs");
}

#[test]
fn a_cursor_helper_window_is_refused_before_the_worker_runs() {
    // Given: window 42 is a visible cursor helper the overlay guard excludes.
    let _reasons = ReasonsGuard::new();
    override_availability(Some(Ok(())));
    override_capture(Some(worker_must_not_run));
    // When: a capture targets that window through the SCK route.
    let result = capture().capture_via_sck(&Target::Window("42".to_owned()), &[], &[42]);
    override_capture(None);
    override_availability(None);
    // Then: it fails as a capture error without asking the worker for its pixels.
    let error = result.unwrap_err();
    assert_eq!(error.code, ErrorCode::CaptureFailed);
    assert!(error.message.contains("cursor-helper"), "{}", error.message);
}

#[test]
fn a_reply_level_capture_error_surfaces_without_fallback() {
    let _reasons = ReasonsGuard::new();
    override_availability(Some(Ok(())));
    override_capture(Some(fake_unavailable));
    let result = capture().capture_via_sck(&Target::Window("42".to_owned()), &[], &[]);
    override_capture(None);
    override_availability(None);
    let error = result.unwrap_err();
    assert_eq!(error.code, ErrorCode::CaptureUnavailable);
    assert_eq!(
        error.capture_unavailable.map(|data| data.reason),
        Some("minimized".to_owned())
    );
}

#[test]
fn an_sck_window_capture_is_not_legacy_and_carries_is_on_screen() {
    let _reasons = ReasonsGuard::new();
    override_availability(Some(Ok(())));
    override_capture(Some(fake_frames));
    let result = capture().capture_via_sck(&Target::Window("42".to_owned()), &[], &[]);
    override_capture(None);
    override_availability(None);
    let Some((_image, geometry)) = result.unwrap() else {
        panic!("expected an SCK capture");
    };
    assert!(!geometry.is_legacy_capture());
    assert_eq!(geometry.window_is_on_screen(), Some(false));
}

fn fake_owned_off_screen(
    _requests: &[SckTargetRequest],
) -> Result<Vec<SckFrame>, SckCaptureError> {
    Ok(vec![SckFrame { pid: Some(7), ..sck_frame() }])
}

fn capture_off_screen_window(
    probe: fn(i32, u32) -> Option<bool>,
) -> CoreResult<Option<(RgbaImage, FrameGeometry)>> {
    override_availability(Some(Ok(())));
    override_capture(Some(fake_owned_off_screen));
    override_probe(Some(probe));
    let result = capture().capture_via_sck(&Target::Window("42".to_owned()), &[], &[]);
    override_probe(None);
    override_capture(None);
    override_availability(None);
    result
}

#[test]
fn a_minimized_off_screen_window_is_refused_with_capture_unavailable() {
    let _reasons = ReasonsGuard::new();
    // Given an off-screen window that Accessibility reports minimized
    let error = capture_off_screen_window(|pid, window| (pid == 7 && window == 42).then_some(true))
        .unwrap_err();
    // Then it is refused, not returned as a stale image
    assert_eq!(error.code, ErrorCode::CaptureUnavailable);
    assert_eq!(
        error.capture_unavailable.map(|data| data.reason),
        Some("minimized".to_owned())
    );
}

#[test]
fn an_off_space_window_is_captured_with_is_on_screen_false() {
    let _reasons = ReasonsGuard::new();
    // Given an off-screen window that is not minimized (another Space)
    let captured = capture_off_screen_window(|_, _| Some(false)).unwrap();
    // Then it is captured and says it is off screen
    let Some((_image, geometry)) = captured else { panic!("expected an SCK capture") };
    assert_eq!(geometry.window_is_on_screen(), Some(false));
}

#[test]
fn an_off_screen_window_is_captured_when_minimized_is_unknown() {
    let _reasons = ReasonsGuard::new();
    // Given no Accessibility answer
    let captured = capture_off_screen_window(|_, _| None).unwrap();
    // Then the capture is returned rather than refused on a guess
    assert!(captured.is_some());
}

#[test]
fn a_successful_sck_capture_clears_start_failure_and_allows_logging_again() {
    let _reasons = ReasonsGuard::new();
    override_availability(Some(Ok(())));
    override_capture(Some(fake_frames));
    let capture = capture();
    let lines = RefCell::new(Vec::new());
    for _ in 0..2 {
        with_legacy_reasons(|store| {
            note_legacy_into(store, REASON_START_FAILED, "start failed", |line| {
                lines.borrow_mut().push(line.to_owned());
            });
        });
        assert!(capture.legacy_capture());
        let (_, geometry) = capture
            .capture_with_exclusions(&Target::Window("42".to_owned()), &[])
            .unwrap();
        assert!(!geometry.is_legacy_capture());
        assert!(!capture.legacy_capture());
    }
    override_capture(None);
    override_availability(None);
    assert_eq!(lines.borrow().len(), 2);
}

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
    super::super::sck::test_support::fake_helper(dir, &script)
}

/// A FIFO whose first writer wakes the returned receiver.
fn started_signal(dir: &tempfile::TempDir) -> (std::path::PathBuf, std::sync::mpsc::Receiver<()>) {
    let fifo = dir.path().join("signal");
    let name = std::ffi::CString::new(fifo.as_os_str().as_encoded_bytes()).unwrap();
    // SAFETY: `name` is a valid NUL-terminated path for the duration of the call.
    assert_eq!(unsafe { libc::mkfifo(name.as_ptr(), 0o600) }, 0);
    let (send, receive) = std::sync::mpsc::channel();
    let reader = fifo.clone();
    std::thread::spawn(move || {
        let _ = std::fs::read(reader);
        let _ = send.send(());
    });
    (fifo, receive)
}

/// Runs one capture on its own session thread with `helper` and a private lock.
fn capture_on_session_thread(
    helper: std::path::PathBuf,
    lock: std::path::PathBuf,
    warm: Duration,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        super::super::sck::TEST_WARM_TIMEOUT.set(Some(warm));
        let _reasons = ReasonsGuard::new();
        override_availability(Some(Ok(())));
        super::super::TEST_LOCK_PATH.with_borrow_mut(|path| *path = Some(lock));
        let _program = super::super::sck::test_support::ProgramGuard::new(helper);
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
    let (fifo, signalled) = started_signal(&dir);
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
    // Given: a warm helper that receives the capture request and then stalls
    let dir = tempfile::tempdir().unwrap();
    let lock = dir.path().join("capture.lock");
    let (fifo, signalled) = started_signal(&dir);
    let helper = signalling_helper(&dir, &fifo, "ready()\nsys.stdin.readline()\nsignal()\ntime.sleep(30)");
    let session = capture_on_session_thread(helper, lock.clone(), Duration::from_secs(30));
    signalled.recv_timeout(Duration::from_secs(40)).expect("capture request reached the helper");
    // When: another session captures while the stalled capture holds the lock
    let other = concurrent_capture(&lock);
    // Then: the in-lock budget ends the stall inside the other session's wait
    assert!(other.is_ok(), "{other:?}");
    session.join().unwrap();
}

fn fake_timed_out(_requests: &[SckTargetRequest]) -> Result<Vec<SckFrame>, SckCaptureError> {
    Err(SckCaptureError::TimedOut(DesktopError::timeout("budget exceeded")))
}

#[test]
fn an_in_lock_timeout_falls_back_to_legacy_instead_of_failing() {
    // Given: a warm worker that exceeds its in-lock budget
    let _reasons = ReasonsGuard::new();
    override_availability(Some(Ok(())));
    override_capture(Some(fake_timed_out));
    // When: the SCK route runs
    let result = capture().capture_via_sck(&Target::Window("42".to_owned()), &[], &[]);
    override_capture(None);
    override_availability(None);
    // Then: it asks for the legacy fallback (Ok(None)) and reports legacy capture
    assert!(matches!(result, Ok(None)), "{result:?}");
    assert!(capture().legacy_capture());
}
