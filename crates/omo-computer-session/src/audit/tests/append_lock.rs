//! A-IS-65 L7, tests T6 and T12: the writer's per-append lock across processes. On Windows it
//! is taken on the hand's `audit.lock`, never on the data file, so a read of the data file in
//! another process never fails on a byte-range lock; on every OS two processes appending at
//! once leave lines that all parse and segments whose `seq` has no gap.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use serde_json::Value;

use crate::audit::{audit_path, AuditEvent, AuditLimits, AuditSink, AuditWriter, WriterId};
use crate::test_process::{playing, until_released, Player};

const HAND: &str = "hand-1";
const LINES: u64 = 40;
const READY: &str = "READY";

fn event(action: &str) -> AuditEvent {
    AuditEvent {
        action: action.to_owned(),
        target: "window:101".to_owned(),
        ..AuditEvent::default()
    }
}

fn writer(dir: &Path) -> AuditWriter {
    AuditWriter::open(dir, HAND, 1, WriterId::current(), AuditLimits::default())
        .expect("the hand's writer")
}

#[test]
fn role_appender() {
    if let Some(dir) = playing("appender") {
        let mut writer = writer(&dir);
        println!("{READY}");
        until_released();
        for index in 0..LINES {
            writer
                .append(event(&format!("append-{index}")))
                .expect("appended");
        }
    }
}

#[test]
fn two_processes_appending_at_once_leave_parseable_lines_and_gapless_segments() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = concat!(module_path!(), "::role_appender");
    let mut first = Player::spawn(path, "appender", dir.path());
    let mut second = Player::spawn(path, "appender", dir.path());
    first.wait_for(&[READY]);
    second.wait_for(&[READY]);
    first.release();
    second.release();
    assert!(first.exited().success());
    assert!(second.exited().success());
    let text = fs::read_to_string(audit_path(dir.path(), HAND)).expect("the audit file");
    let mut segments: BTreeMap<u64, Vec<u64>> = BTreeMap::new();
    for line in text.lines() {
        let line: Value = serde_json::from_str(line).expect("every line parses");
        if let Some(seq) = line.get("seq").and_then(Value::as_u64) {
            let pid = line["writerPid"]
                .as_u64()
                .expect("a stamped line names its writer");
            segments.entry(pid).or_default().push(seq);
        }
    }
    assert_eq!(segments.len(), 2, "one segment per writer: {segments:?}");
    for (pid, seqs) in segments {
        assert_eq!(
            seqs,
            (1..=LINES).collect::<Vec<_>>(),
            "writer {pid}'s seq has no gap"
        );
    }
}

#[cfg(windows)]
#[test]
fn role_append_lock_holder() {
    if let Some(dir) = playing("append-lock-holder") {
        let lock = audit_path(&dir, HAND).with_file_name(crate::audit::AUDIT_LOCK_FILE);
        let held = crate::lock::file::lock(crate::lock::file::open(&lock).expect("audit.lock"))
            .expect("the append lock");
        println!("{READY}");
        until_released();
        drop(held);
    }
}

#[cfg(windows)]
#[test]
fn an_append_in_one_process_does_not_fail_a_read_of_the_audit_file_in_another() {
    let dir = tempfile::tempdir().expect("tempdir");
    let mut writer = writer(dir.path());
    let path = concat!(module_path!(), "::role_append_lock_holder");
    let mut holder = Player::spawn(path, "append-lock-holder", dir.path());
    holder.wait_for(&[READY]);
    let read = fs::read_to_string(audit_path(dir.path(), HAND));
    assert!(
        read.as_deref()
            .is_ok_and(|text| text.contains("audit.meta")),
        "the data file reads while another process holds the append lock: {read:?}"
    );
    let pending = std::thread::spawn(move || writer.append(event("after-release")).map(drop));
    holder.release();
    let appended = crate::test_process::within("the append", move || pending.join());
    assert!(matches!(appended, Ok(Ok(()))), "{appended:?}");
    assert!(holder.exited().success());
}
