//! A-IS-62 R7-2: the hard cap never refuses a chord refusal's line. A writer at `hard_cap` still
//! appends one chord-refusal line per segment, then refuses exec as before; and a refusal line is
//! never written as a truncated event (its chords are cut to 256 bytes by row 21, never here).

use std::fs;
use std::path::Path;

use serde_json::Value;

use crate::audit::{
    AuditEvent, AuditLimits, AuditSink, AuditWriter, Gate, GateOutcome, Status, WriterId,
    AUDIT_UNAVAILABLE,
};

/// The line row 21's `refuse_carried_chord` writes (grant/host.rs:308-324).
pub(super) fn chord_refusal(carried: &str) -> AuditEvent {
    AuditEvent {
        action: "stopPath.start".to_owned(),
        target: "stop_hotkey".to_owned(),
        gate: Gate {
            outcome: GateOutcome::Refused,
            stage: Some("Consent".to_owned()),
            code: Some("ControlRequired".to_owned()),
            reason: Some("tampered".to_owned()),
        },
        status: Status::Refused,
        primary_error: Some("ControlRequired".to_owned()),
        evidence: vec![
            "configured=ctrl+alt+shift+escape".to_owned(),
            format!("carried={carried}"),
        ],
        ..AuditEvent::default()
    }
}

fn click() -> AuditEvent {
    AuditEvent {
        action: "click".to_owned(),
        target: "window:101".to_owned(),
        ..AuditEvent::default()
    }
}

fn lines(path: &Path) -> Vec<Value> {
    fs::read_to_string(path)
        .expect("audit file")
        .lines()
        .map(|line| serde_json::from_str(line).expect("JSON line"))
        .collect()
}

fn writer(dir: &Path, limits: AuditLimits) -> AuditWriter {
    let id = WriterId {
        pid: 21,
        proc_start_ms: 3,
    };
    AuditWriter::open(dir, "hand-1", 1, id, limits).expect("writer")
}

#[test]
fn a_chord_refusal_at_the_hard_cap_is_written_once_per_segment_and_exec_stays_refused() {
    let dir = tempfile::tempdir().expect("tempdir");
    let limits = AuditLimits {
        rotate_at: 1 << 20,
        hard_cap: 2_000,
        max_event: 1 << 20,
    };
    let mut writer = writer(dir.path(), limits);
    while writer.admit().is_ok() {
        writer.append(click()).expect("appends up to the hard cap");
    }
    assert_eq!(writer.admit(), Err(AUDIT_UNAVAILABLE), "the writer is at the hard cap");
    writer
        .append(chord_refusal("ctrl+q"))
        .expect("the hard cap never refuses a chord refusal's line");
    let refusals = |path: &Path| {
        lines(path)
            .into_iter()
            .filter(|line| line["target"] == "stop_hotkey" && line["status"] == "refused")
            .count()
    };
    assert_eq!(refusals(writer.path()), 1, "the refusal line is in the hand's file");
    assert!(
        writer.append(chord_refusal("ctrl+w")).is_err(),
        "one chord-refusal line per segment past the cap"
    );
    assert_eq!(refusals(writer.path()), 1);
    assert_eq!(writer.admit(), Err(AUDIT_UNAVAILABLE), "exec is refused as before");
    assert!(writer.append(click()).is_err(), "any other line is still refused at the cap");
}

#[test]
fn a_refusal_line_is_never_written_as_a_truncated_event() {
    let dir = tempfile::tempdir().expect("tempdir");
    let limits = AuditLimits {
        rotate_at: 1 << 20,
        hard_cap: 1 << 20,
        max_event: 300,
    };
    let mut writer = writer(dir.path(), limits);
    let carried = "k".repeat(256);
    writer.append(chord_refusal(&carried)).expect("the refusal line");
    let all = lines(writer.path());
    let refusal = all
        .iter()
        .find(|line| line["target"] == "stop_hotkey")
        .expect("the refusal line is written");
    assert!(
        refusal.get("warnings").is_none(),
        "never the truncated form: {refusal}"
    );
    assert_eq!(refusal["evidence"][1], Value::from(format!("carried={carried}")));
    assert_eq!(refusal["gate"]["reason"], "tampered");
}
