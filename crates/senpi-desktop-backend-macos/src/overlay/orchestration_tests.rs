use super::{coordination, Overlay};
use crate::focus::WindowInfo;
use senpi_desktop_core::error::{DesktopError, ErrorCode};
use std::sync::mpsc;
use std::time::Duration;

const GUARD: Duration = Duration::from_secs(30);

#[test]
fn concurrent_cursor_off_captures_wait_and_both_succeed() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("overlay.lock");
    let (entered, first_entered) = mpsc::channel();
    let (release, first_release) = mpsc::channel();
    let first_path = path.clone();
    let first = std::thread::spawn(move || {
        Overlay::default().capture(
            &first_path,
            || Ok(Vec::new()),
            std::thread::sleep,
            |_| {
                entered.send(()).unwrap();
                first_release.recv_timeout(GUARD).unwrap();
                Ok(1)
            },
        )
    });
    first_entered.recv_timeout(GUARD).unwrap();

    let (blocked, second_blocked) = mpsc::channel();
    let (resume, second_resume) = mpsc::channel();
    let second_path = path.clone();
    let second = std::thread::spawn(move || {
        Overlay::default().capture(
            &second_path,
            || Ok(Vec::new()),
            move |_| {
                // Observe the actual failed flock before releasing the first capture.
                blocked.send(()).unwrap();
                second_resume.recv_timeout(GUARD).unwrap();
            },
            |_| Ok(2),
        )
    });
    second_blocked.recv_timeout(GUARD).unwrap();
    release.send(()).unwrap();
    assert_eq!(first.join().unwrap().unwrap(), 1);
    resume.send(()).unwrap();
    assert_eq!(second.join().unwrap().unwrap(), 2);
}

#[test]
fn capture_succeeds_after_a_foreign_visible_holder_releases() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("overlay.lock");
    let mut visible = coordination::visible(coordination::open(&path).unwrap()).unwrap();
    assert!(visible.is_some());
    let result = Overlay::default().capture(
        &path,
        || Ok(Vec::new()),
        |_| drop(visible.take()),
        |_| Ok(7),
    );
    assert_eq!(result.unwrap(), 7);
    assert!(visible.is_none());
}

#[test]
fn capture_passes_a_foreign_visible_window_id_to_the_exclusion_backend() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("overlay.lock");
    let mut ran = false;
    let result = Overlay::default().capture(
        &path,
        || {
            Ok(vec![WindowInfo {
                pid: 77,
                window_number: 88,
                layer: 1000,
                on_screen: true,
                cursor_overlay: true,
            }])
        },
        std::thread::sleep,
        |excluded| {
            assert_eq!(excluded, [88]);
            ran = true;
            Ok(())
        },
    );
    result.unwrap();
    assert!(ran);
    assert!(coordination::visible(coordination::open(&path).unwrap()).unwrap().is_some());
}

#[test]
fn capture_binds_the_exclusive_lock_through_pixels_and_releases_on_error() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("overlay.lock");
    let result = Overlay::default().capture(
        &path,
        || Ok(Vec::new()),
        std::thread::sleep,
        |_| {
            // A missing or prematurely dropped binding permits a helper to appear here.
            assert!(coordination::visible(coordination::open(&path).unwrap()).unwrap().is_none());
            Err::<(), _>(DesktopError::capture_failed("synthetic screenshot error"))
        },
    );
    assert_eq!(result.unwrap_err().code, ErrorCode::CaptureFailed);
    assert!(coordination::visible(coordination::open(&path).unwrap()).unwrap().is_some());
}
