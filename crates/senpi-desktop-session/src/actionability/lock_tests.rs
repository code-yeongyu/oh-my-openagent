//! Independent fake engines share a machine-wide lock, but not admission.

use std::io::{BufRead, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{mpsc, Arc};
use std::time::Duration;

use senpi_desktop_backend_fake::{FakeMethod, SinkOp};
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::report::{Disposition, ReportMode};
use senpi_desktop_core::types::DesktopSessionOptions;
use serde_json::json;

use crate::grant::ControlSlot;
use crate::test_support::{click_window, harness_opened, harness_with_slot};

use super::{button, opened, press, pressed, report, scene};

const CHILD_DIR: &str = "SENPI_ACTIONABILITY_TEST_ENGINE_DIR";
const TEST: &str = "actionability::tests::lock_tests::another_engine_sends_input_while_actionability_waits";
const BUDGET: Duration = Duration::from_secs(15);

struct Engine(Child);

impl Drop for Engine {
    fn drop(&mut self) {
        if !matches!(self.0.try_wait(), Ok(Some(_))) {
            if let Err(error) = self.0.kill() {
                eprintln!("stopping fake engine: {error}");
            }
            if let Err(error) = self.0.wait() {
                eprintln!("reaping fake engine: {error}");
            }
        }
    }
}

#[test]
fn another_engine_sends_input_while_actionability_waits() {
    if let Some(dir) = std::env::var_os(CHILD_DIR) {
        let slot = ControlSlot::with_lock_dir(dir.into());
        let options = DesktopSessionOptions { report_mode: ReportMode::Object, ..DesktopSessionOptions::default() };
        let mut a = harness_opened(&scene(button(&json!({"moving_reads": 3})), &[]), slot, options);
        let reference = a.focused_ref();
        // Two reads establish movement. Gate the next observation until B sends.
        a.faults.on_next(FakeMethod::AxProps, || {});
        a.faults.on_next(FakeMethod::AxProps, || {});
        a.faults.on_next(FakeMethod::AxProps, || {
            println!("\nACTIONABILITY_WAITING");
            std::io::stdout().flush().expect("flush readiness event");
            let mut ready = String::new();
            std::io::stdin().read_line(&mut ready).expect("read readiness release");
            assert_eq!(ready.trim(), "READY");
        });
        assert!(press(&mut a, reference).is_ok());
        assert_eq!(pressed(&a), 1);
        return;
    }

    // Given: separate processes, the same fake runtime directory.
    let dir = tempfile::tempdir().expect("runtime dir");
    let mut a = Engine(Command::new(std::env::current_exe().expect("test executable"))
        .args(["--exact", TEST, "--nocapture"])
        .env(CHILD_DIR, dir.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn().expect("start engine A"));
    let stdout = a.0.stdout.take().expect("A stdout");
    let (events, received) = mpsc::channel();
    let reader = std::thread::spawn(move || {
        for line in std::io::BufReader::new(stdout).lines() {
            if line.expect("A output").contains("ACTIONABILITY_WAITING") {
                events.send(false).expect("waiting event");
            }
        }
        events.send(true).expect("exit event");
    });
    assert!(!received.recv_timeout(BUDGET).expect("A enters the pending poll"));
    let mut b = harness_with_slot(&json!({}), ControlSlot::with_lock_dir(dir.path().to_owned()));
    let frame = b.capture("101");

    // When: A cannot finish its pending observation until B completes.
    let sent = b.process(click_window(&frame, None));
    assert!(sent.is_ok(), "B must complete, including no InputBusy: {sent:?}");
    assert_eq!(b.sink.ops().iter().filter(|op| matches!(op, SinkOp::Pointer { .. })).count(), 1);
    assert!(matches!(received.try_recv(), Err(mpsc::TryRecvError::Empty)), "A still waits");
    writeln!(a.0.stdin.as_mut().expect("A stdin"), "READY").expect("make A ready");

    // Then: A also completes, after its scripted bounds become stable.
    assert!(received.recv_timeout(BUDGET).expect("A exits after becoming ready"));
    assert!(a.0.wait().expect("A exit status").success());
    reader.join().expect("event reader");
}

#[test]
fn the_check_under_the_lock_observes_once_and_sends_nothing_when_it_fails() {
    // Given: the wait passed; the first read under the lock fails.
    let dir = tempfile::tempdir().expect("runtime dir");
    let slot = ControlSlot::with_lock_dir(dir.path().to_owned());
    let options = DesktopSessionOptions { report_mode: ReportMode::Object, ..DesktopSessionOptions::default() };
    let mut harness = harness_opened(
        &scene(button(&json!({"moving_reads": 2})), &[]), Arc::clone(&slot), options,
    );
    let reference = harness.focused_ref();
    // The lock observer scripts a failing first under-lock read. If the
    // recheck retries, it would consume the second failure too.
    let faults = harness.faults.clone();
    *slot.interaction().observer.lock() = Some(Arc::new(move |taken| {
        if taken {
            faults.fail_next(FakeMethod::AxProps, ErrorCode::AxFailed);
            faults.fail_next(FakeMethod::AxProps, ErrorCode::AxUnsupported);
        }
    }));
    // When
    let error = press(&mut harness, reference).expect_err("fresh check refuses");
    // Then: the exact read failure and nothing-sent classification survive.
    assert_eq!(error.code, ErrorCode::AxFailed);
    assert_eq!(report(&error).disposition, Some(Disposition::NOT_DELIVERED_SAFE));
    assert_eq!(pressed(&harness), 0);
    let before = harness.faults.calls(FakeMethod::AxProps);
    harness.process(crate::request::Op::AxFocused).expect_err("second failure is still queued");
    assert_eq!(harness.faults.calls(FakeMethod::AxProps), before + 1);
}

#[test]
fn cancellation_during_actionability_wait_sends_nothing() {
    // Given: cancellation lands after an unstable observation.
    let mut harness = opened(&scene(button(&json!({"moving_reads": 10})), &[]), ReportMode::Object);
    let reference = harness.focused_ref();
    let cancelled = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let signal = Arc::clone(&cancelled);
    harness.faults.on_next(FakeMethod::AxProps, || {});
    harness.faults.on_next(FakeMethod::AxProps, move || {
        signal.store(true, std::sync::atomic::Ordering::SeqCst);
    });
    // When
    let error = harness.worker.ax_perform(&reference, "press", &|| {
        cancelled.load(std::sync::atomic::Ordering::SeqCst)
    }).expect_err("cancelled during the wait");
    // Then
    assert_eq!(error.code, ErrorCode::Cancelled);
    assert_eq!(report(&error).disposition, Some(Disposition::NOT_DELIVERED_SAFE));
    assert_eq!(pressed(&harness), 0);
}
