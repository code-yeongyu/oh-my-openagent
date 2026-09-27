use std::fs;
use std::path::{Path, PathBuf};

use senpi_desktop_core::methods::Method;
use senpi_desktop_core::protocol_params::TypeTextParams;
use senpi_desktop_core::types::DesktopSessionOptions;
use serde_json::{json, Value};

use super::{append, append_rotating};
use crate::audit::{AuditRecord, AuditStatus};
use crate::request::Op;
use crate::test_support::{click_window, harness};

fn sample() -> AuditRecord {
    AuditRecord {
        timestamp: "2023-11-14T22:13:20.000Z".to_owned(),
        session_id: "session".to_owned(),
        run_id: "run".to_owned(),
        action: Method::Click,
        target: "101".to_owned(),
        delivery: "background".to_owned(),
        frame_id: None,
        code: None,
        status: AuditStatus::Success,
        primary_error: None,
        duration_ms: 4,
        focus_restored: None,
        screenshot_path: None,
        screenshot_width: None,
        screenshot_height: None,
        text_length: None,
        text_sha256: None,
        keys: None,
        message: None,
    }
}

fn lines_of(path: &Path) -> Vec<Value> {
    fs::read_to_string(path)
        .expect("audit file")
        .lines()
        .map(|line| serde_json::from_str(line).expect("valid JSON line"))
        .collect()
}

fn open_with_audit(harness: &mut crate::test_support::Harness, path: PathBuf) {
    harness.worker.open(DesktopSessionOptions {
        audit_path: Some(path),
        ..DesktopSessionOptions::default()
    });
}

#[test]
fn audit_writes_one_json_line_per_action() {
    // Given
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join(".computer-audit.jsonl");
    let mut harness = harness(&json!({}));
    open_with_audit(&mut harness, path.clone());
    let frame = harness.capture("101");
    // When
    harness.process(click_window(&frame, None)).expect("click 1");
    harness.process(click_window(&frame, None)).expect("click 2");
    // Then
    let lines = lines_of(&path);
    assert_eq!(lines.len(), 2);
    for line in &lines {
        assert_eq!(line["action"], "click");
        assert_eq!(line["status"], "success");
        assert_eq!(line["target"], "101");
        assert!(line["sessionId"].as_str().is_some_and(|id| !id.is_empty()));
        assert!(line["runId"].as_str().is_some_and(|id| !id.is_empty()));
        assert!(line["timestamp"].as_str().is_some_and(|ts| ts.ends_with('Z')));
    }
}

#[test]
fn audit_file_mode_is_owner_rw_only() {
    // Given
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join(".computer-audit.jsonl");
    // When
    append(&path, &sample());
    // Then
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(&path).expect("meta").permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }
    #[cfg(not(unix))]
    {
        assert!(path.is_file());
    }
}

#[test]
fn audit_path_none_creates_no_file() {
    // Given: a directory the session knows about, but auditPath is null.
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join(".computer-audit.jsonl");
    let mut harness = harness(&json!({}));
    harness.worker.open(DesktopSessionOptions {
        audit_path: None,
        artifact_dir: Some(dir.path().to_path_buf()),
        ..DesktopSessionOptions::default()
    });
    let frame = harness.capture("101");
    // When
    harness.process(click_window(&frame, None)).expect("click");
    // Then
    assert!(!path.exists(), "null auditPath must not create a log");
}

#[test]
fn audit_type_records_text_sha256_and_never_the_text() {
    // Given
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join(".computer-audit.jsonl");
    let mut harness = harness(&json!({}));
    open_with_audit(&mut harness, path.clone());
    let secret = "s3cret-password-xyz";
    let op = Op::TypeText(TypeTextParams {
        target: "101".to_owned(),
        text: secret.to_owned(),
        opts: None,
    });
    // When
    harness.process(op).expect("types");
    // Then
    let raw = fs::read_to_string(&path).expect("audit file");
    assert!(!raw.contains(secret), "typed text must be absent: {raw}");
    let line = lines_of(&path).pop().expect("one line");
    assert_eq!(line["action"], "typeText");
    assert!(line.get("text").is_none());
    assert!(line["textSha256"].as_str().is_some_and(|h| h.len() == 16));
    assert_eq!(line["textLength"], 19);
}

#[test]
fn audit_rotates_to_numbered_sibling_at_size_cap() {
    // Given: a live file already at the rotate threshold.
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join(".computer-audit.jsonl");
    fs::write(&path, vec![b'x'; 32]).expect("seed");
    // When
    append_rotating(&path, &sample(), 32);
    // Then
    let rotated = dir.path().join(".computer-audit.1.jsonl");
    assert_eq!(fs::read(&rotated).expect("rotated"), vec![b'x'; 32]);
    let lines = lines_of(&path);
    assert_eq!(lines.len(), 1);
    assert_eq!(lines[0]["action"], "click");
}

#[cfg(unix)]
#[test]
fn audit_read_only_dir_does_not_fail_the_action() {
    use std::os::unix::fs::PermissionsExt;

    use crate::audit::take_warnings;

    // Given
    let dir = tempfile::tempdir().expect("tempdir");
    let locked = dir.path().join("locked");
    fs::create_dir(&locked).expect("locked dir");
    let path = locked.join(".computer-audit.jsonl");
    let mut harness = harness(&json!({}));
    open_with_audit(&mut harness, path);
    let mut perms = fs::metadata(&locked).expect("meta").permissions();
    perms.set_mode(0o555);
    fs::set_permissions(&locked, perms.clone()).expect("lock");
    struct Restore<'a> {
        path: &'a Path,
        mode: u32,
    }
    impl Drop for Restore<'_> {
        fn drop(&mut self) {
            let mut perms = fs::metadata(self.path).expect("meta").permissions();
            perms.set_mode(self.mode);
            fs::set_permissions(self.path, perms).expect("unlock");
        }
    }
    let _restore = Restore {
        path: &locked,
        mode: 0o755,
    };
    let frame = harness.capture("101");
    take_warnings();
    // When
    let reply = harness.process(click_window(&frame, None));
    // Then: the action succeeds and exactly one stderr warning was emitted.
    assert!(reply.is_ok(), "{reply:?}");
    let warnings = take_warnings();
    assert_eq!(warnings.len(), 1, "{warnings:?}");
    assert!(warnings[0].contains("audit log write failed"), "{warnings:?}");
}

#[test]
fn audit_line_is_valid_json_object() {
    // Given / When
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("audit.jsonl");
    append(&path, &sample());
    // Then
    let parsed: AuditRecord = serde_json::from_str(
        fs::read_to_string(&path)
            .expect("file")
            .lines()
            .next()
            .expect("line"),
    )
    .expect("AuditRecord");
    assert_eq!(parsed.action, Method::Click);
    assert_eq!(parsed.status, AuditStatus::Success);
    assert_eq!(parsed.code, None);
}
