use std::fs;
use std::path::Path;

use serde_json::{json, Value};

use crate::audit::{
    line_hash, Anchor, AuditEvent, AuditLimits, AuditSink, AuditWriter, WriterId,
    AUDIT_UNAVAILABLE, ROTATED_FILE,
};

fn event(action: &str) -> AuditEvent {
    AuditEvent {
        action: action.to_owned(),
        target: "window:101".to_owned(),
        call_id: format!("{action}-call"),
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

fn files_under(dir: &Path) -> Vec<String> {
    let mut found = Vec::new();
    let mut stack = vec![dir.to_owned()];
    while let Some(next) = stack.pop() {
        for entry in fs::read_dir(next).expect("dir").filter_map(Result::ok) {
            if entry.path().is_dir() {
                stack.push(entry.path());
            } else {
                found.push(entry.path().strip_prefix(dir).expect("under").display().to_string());
            }
        }
    }
    found
}

#[test]
fn audit_is_one_file_per_hand_with_per_writer_segments() {
    let dir = tempfile::tempdir().expect("tempdir");
    let limits = AuditLimits::default();
    let mut first = AuditWriter::open(dir.path(), "hand-1", 1, WriterId { pid: 100, proc_start_ms: 5 }, limits).expect("first");
    let mut second = AuditWriter::open(dir.path(), "hand-1", 1, WriterId { pid: 200, proc_start_ms: 7 }, limits).expect("second");
    first.append(event("click")).expect("append");
    second.append(event("typeText")).expect("append");
    first.append(event("click")).expect("append");
    assert_eq!(files_under(dir.path()), vec!["computer/hand-1/audit.jsonl".to_owned()], "one file per hand");
    let all = lines(first.path());
    let metas: Vec<&Value> = all.iter().filter(|line| line["kind"] == "audit.meta").collect();
    assert_eq!(metas.iter().map(|meta| meta["writerPid"].clone()).collect::<Vec<_>>(), vec![json!(100), json!(200)]);
    assert!(metas.iter().all(|meta| meta["schema"] == 2 && meta["handId"] == "hand-1"));
    for pid in [100, 200] {
        let segment: Vec<&Value> = all
            .iter()
            .filter(|line| line["writerPid"] == pid && line.get("kind").is_none())
            .collect();
        let mut prev = "meta".to_owned();
        for (index, line) in segment.iter().enumerate() {
            assert_eq!(line["seq"], json!(index + 1), "seq per writer");
            assert_eq!(line["prev"], json!(prev), "the per-segment chain");
            assert_eq!(line["lineHash"], json!(line_hash(line)), "lineHash recomputes");
            assert_eq!(line["v"], json!(2));
            prev = line["lineHash"].as_str().expect("hash").to_owned();
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(fs::metadata(first.path()).expect("file").permissions().mode() & 0o777, 0o600);
    }
}


#[test]
fn rotation_anchor_carries_fingerprint_latch_and_prev_line_hash() {
    let dir = tempfile::tempdir().expect("tempdir");
    let limits = AuditLimits { rotate_at: 2_000, hard_cap: 1 << 20, max_event: 1 << 20 };
    let anchor = Anchor { fingerprint: "fp-1".to_owned(), suspended: false, stop_epoch: 3 };
    let mut host = AuditWriter::open_authority(dir.path(), "hand-1", 1, WriterId { pid: 300, proc_start_ms: 9 }, limits, anchor).expect("host");
    let rotated = host.path().with_file_name(ROTATED_FILE);
    let mut appended = 0;
    while !rotated.exists() {
        host.append(event("click")).expect("append");
        appended += 1;
        assert!(appended < 100, "the authority host rotates at rotate_at");
    }
    let closed = lines(&rotated);
    let closed_last = closed.last().expect("closed segment")["lineHash"].clone();
    let current = lines(host.path());
    assert_eq!(current[0]["kind"], json!("audit.meta"));
    let first = &current[1];
    assert_eq!(first["grant"]["kind"], json!("consent_save"));
    assert_eq!(first["grant"]["verdict"], json!("rotation_anchor"));
    assert_eq!(first["grant"]["consent"], json!({ "fingerprint": "fp-1" }));
    assert_eq!(first["grant"]["latch"], json!({ "suspended": false, "stopEpoch": 3 }));
    assert_eq!(first["prev"], closed_last, "prev is the closed segment's last lineHash");
    assert_eq!(closed[1]["grant"]["verdict"], json!("rotation_anchor"), "the first segment opened with one too");

    let capped = AuditLimits { rotate_at: 500, hard_cap: 1_000, max_event: 1 << 20 };
    let other = tempfile::tempdir().expect("tempdir");
    let mut writer = AuditWriter::open(other.path(), "hand-2", 1, WriterId { pid: 400, proc_start_ms: 1 }, capped).expect("writer");
    while writer.admit().is_ok() {
        writer.append(event("click")).expect("appends up to the hard cap");
    }
    assert_eq!(writer.admit(), Err(AUDIT_UNAVAILABLE));
    assert!(!writer.path().with_file_name(ROTATED_FILE).exists(), "only the authority host rotates");
}

