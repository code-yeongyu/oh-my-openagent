use std::collections::BTreeSet;
use std::sync::atomic::Ordering;
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};

use senpi_desktop_core::background_action::BackgroundActionState;
use senpi_desktop_core::background_focus::{BackgroundFocusLease, SwitchSignals};
use senpi_desktop_core::key_reroute::audit::DisarmReason;
use senpi_desktop_core::protocol_params::TypeTextParams;
use senpi_desktop_core::types::DesktopSessionOptions;
use serde_json::{json, Value};

use crate::request::Op;
use crate::test_support::harness;

#[test]
fn linger_on_another_thread_records_one_content_free_arm_and_disarm() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("audit.jsonl");
    let mut h = harness(&json!({}));
    h.worker.open(DesktopSessionOptions {
        audit_path: Some(path.clone()),
        ..DesktopSessionOptions::default()
    });
    let state = Arc::new(BackgroundActionState::new(BackgroundFocusLease::new(
        4242,
        7,
        Some(101),
        SwitchSignals::default(),
        Instant::now(),
    )));
    *h.watches.background.state.lock() = Some(state);
    h.watches
        .background
        .arm_reroute
        .store(true, Ordering::SeqCst);
    h.process(Op::TypeText(TypeTextParams {
        target: "101".into(),
        text: "content-must-not-enter-lifecycle-records".into(),
        opts: None,
    }))
    .unwrap();

    let before = read_records(&path);
    assert_eq!(
        before
            .iter()
            .filter(|row| row["event"] == "keyReroute.arm")
            .count(),
        1
    );
    assert_eq!(
        before
            .iter()
            .filter(|row| row["event"] == "keyReroute.disarm")
            .count(),
        0
    );
    assert_eq!(h.background_logs.lock().len(), 1);

    let mut linger = h.watches.background.reroute.lock().take().unwrap();
    for _ in 0..7 {
        linger.moved_key();
    }
    let caller = std::thread::current().id();
    let (release, released) = mpsc::sync_channel(1);
    let (finished, completion) = mpsc::sync_channel(1);
    let thread = std::thread::spawn(move || {
        assert_ne!(std::thread::current().id(), caller);
        released.recv_timeout(Duration::from_secs(5)).unwrap();
        linger.disarm_reason(DisarmReason::LingerExpired);
        drop(linger);
        finished.send(()).unwrap();
    });
    release.send(()).unwrap();
    completion.recv_timeout(Duration::from_secs(5)).unwrap();
    thread.join().unwrap();

    let all = read_records(&path);
    let lifecycle: Vec<_> = all
        .iter()
        .filter(|row| row.get("event").is_some())
        .collect();
    assert_eq!(
        all.len(),
        3,
        "two lifecycle records and the ordinary request audit"
    );
    assert_eq!(lifecycle.len(), 2);
    assert_eq!(lifecycle[0]["event"], "keyReroute.arm");
    assert_eq!(lifecycle[1]["event"], "keyReroute.disarm");
    assert_eq!(lifecycle[0]["armId"], lifecycle[1]["armId"]);
    assert_eq!(lifecycle[1]["movedKeyCount"], 7);
    assert_eq!(lifecycle[1]["reason"], "linger-expired");
    assert_eq!(
        h.audits.lock().len(),
        1,
        "request audit remains one per mutation"
    );

    let logs = h.background_logs.lock();
    assert_eq!(logs.len(), 2);
    for (index, record) in lifecycle.iter().enumerate() {
        assert_eq!(
            serde_json::from_str::<Value>(&logs[index].message).unwrap(),
            **record
        );
        let expected: BTreeSet<_> = if index == 0 {
            [
                "timestamp",
                "sessionId",
                "runId",
                "target",
                "event",
                "armId",
            ]
            .into_iter()
            .collect()
        } else {
            [
                "timestamp",
                "sessionId",
                "runId",
                "target",
                "event",
                "armId",
                "movedKeyCount",
                "reason",
            ]
            .into_iter()
            .collect()
        };
        let actual: BTreeSet<_> = record
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(
            actual, expected,
            "only identity, lifecycle, and count fields"
        );
        assert!(!logs[index]
            .message
            .contains("content-must-not-enter-lifecycle-records"));
    }
}

fn read_records(path: &std::path::Path) -> Vec<Value> {
    std::fs::read_to_string(path)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

#[test]
fn backend_teardown_disarms_once_after_success_failure_or_unwind() {
    use senpi_desktop_core::backend::DeliveryMode;
    use senpi_desktop_core::error::DesktopError;
    use senpi_desktop_safety::MutatingAction;

    for outcome in ["success", "failure", "unwind"] {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("audit.jsonl");
        let mut h = harness(&json!({}));
        h.worker.open(DesktopSessionOptions {
            audit_path: Some(path.clone()),
            ..DesktopSessionOptions::default()
        });
        *h.watches.background.state.lock() = Some(Arc::new(BackgroundActionState::new(
            BackgroundFocusLease::new(4242, 7, Some(101), SwitchSignals::default(), Instant::now()),
        )));
        h.watches
            .background
            .arm_reroute
            .store(true, Ordering::SeqCst);
        let mutation = super::Mutation::new(
            MutatingAction::TypeText,
            "101".into(),
            DeliveryMode::Background,
        );
        let result = h.worker.mutate(&mutation, &|| false, |_| match outcome {
            "success" => Ok(()),
            "failure" => Err(DesktopError::input_failed("injected failure")),
            "unwind" => panic!("injected input unwind"),
            _ => unreachable!(),
        });
        assert_eq!(result.is_ok(), outcome == "success", "{outcome}");
        assert!(h.watches.background.reroute.lock().is_some());
        assert_eq!(h.watches.background.drops.load(Ordering::SeqCst), 1);
        drop(h.worker);
        assert!(h.watches.background.reroute.lock().is_none());
        let records = read_records(&path);
        let lifecycle: Vec<_> = records
            .iter()
            .filter(|row| row.get("event").is_some())
            .collect();
        assert_eq!(lifecycle.len(), 2, "{outcome}");
        assert_eq!(lifecycle[0]["event"], "keyReroute.arm");
        assert_eq!(lifecycle[1]["event"], "keyReroute.disarm");
        assert_eq!(lifecycle[1]["movedKeyCount"], 0);
        assert_eq!(lifecycle[1]["reason"], "engine-exit");
        assert_eq!(h.background_logs.lock().len(), 2);
    }
}

#[test]
fn cancellation_before_admission_never_arms_a_reroute() {
    use senpi_desktop_core::backend::DeliveryMode;
    use senpi_desktop_core::error::ErrorCode;
    use senpi_desktop_safety::MutatingAction;

    let mut h = harness(&json!({}));
    h.watches
        .background
        .arm_reroute
        .store(true, Ordering::SeqCst);
    *h.watches.background.state.lock() = Some(Arc::new(BackgroundActionState::new(
        BackgroundFocusLease::new(4242, 7, Some(101), SwitchSignals::default(), Instant::now()),
    )));
    let mutation = super::Mutation::new(
        MutatingAction::TypeText,
        "101".into(),
        DeliveryMode::Background,
    );
    let error = h
        .worker
        .mutate(&mutation, &|| true, |_| Ok(()))
        .unwrap_err();
    assert_eq!(error.code, ErrorCode::Cancelled);
    assert_eq!(h.watches.background.begins.load(Ordering::SeqCst), 0);
    assert!(h.background_logs.lock().is_empty());
}
