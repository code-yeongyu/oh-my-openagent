use std::time::Duration;

use senpi_desktop_core::error::{DesktopError, ErrorCode};
use senpi_desktop_core::methods::Method;
use senpi_desktop_core::types::DesktopSessionOptions;
use serde_json::{json, Value};

use super::{redact, TraceSink, SCHEMA};
use crate::rpc::Failure;

const SECRET: &str = "hunter2-secret-7731";

/// A directory under the temp dir, removed on drop.
struct Scratch(std::path::PathBuf);

impl Scratch {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("senpi-trace-{}", ulid::Ulid::generate()));
        std::fs::create_dir_all(&path).expect("scratch dir");
        Self(path)
    }

    fn path(&self) -> &std::path::Path {
        &self.0
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn options(dir: &std::path::Path, trace: bool) -> DesktopSessionOptions {
    DesktopSessionOptions {
        audit_path: Some(dir.join("audit.jsonl")),
        trace,
        ..DesktopSessionOptions::default()
    }
}

fn lines(sink: &TraceSink) -> Vec<Value> {
    let path = sink.path().expect("the trace is open");
    std::fs::read_to_string(path)
        .expect("the trace is readable")
        .lines()
        .map(|line| serde_json::from_str(line).expect("every trace line is JSON"))
        .collect()
}

#[test]
fn every_redacted_channel_is_cut_hashed_or_nulled() {
    // Given
    let long = "x".repeat(300);
    let mut report = json!({
        "hit": { "role": "textfield", "label": long },
        "note": long,
        "warning": long,
        "openedSurfaces": [{ "kind": "sheet", "title": long }],
        "event": { "text": SECRET, "url": "https://example.test/short" },
        "node": {
            "secure": true,
            "value": SECRET,
            "title": "Password",
            "children": [{ "label": SECRET, "role": "text" }],
        },
    });
    // When
    redact(&mut report);
    // Then
    let cut = format!("{}[truncated]", "x".repeat(256));
    assert_eq!(report["hit"]["label"], json!(cut));
    assert_eq!(report["openedSurfaces"][0]["title"], json!(cut));
    assert_eq!(report["event"]["text"]["length"], json!(SECRET.chars().count()));
    assert_eq!(report["event"]["text"]["sha256"].as_str().map(str::len), Some(16));
    assert_eq!(report["event"]["url"], json!("https://example.test/short"));
    assert_eq!(
        (&report["node"]["value"], &report["node"]["title"], &report["node"]["children"][0]["label"]),
        (&Value::Null, &Value::Null, &Value::Null)
    );
    assert_eq!(report["node"]["children"][0]["role"], json!("text"));
    assert!(!report.to_string().contains(SECRET));
}

#[test]
fn note_and_warning_keep_their_text_when_short() {
    // Given
    let mut report = json!({ "note": "short", "warning": "secure_field" });
    // When
    redact(&mut report);
    // Then
    assert_eq!(report, json!({ "note": "short", "warning": "secure_field" }));
}

#[test]
fn a_trace_open_writes_the_meta_line_first_and_redacted_replies() {
    // Given
    let dir = Scratch::new();
    let sink = TraceSink::new();
    sink.configure(&options(dir.path(), true));
    let report = json!({
        "disposition": { "delivery": "delivered_unverified", "retry": "unsafe" },
        "hit": { "role": "textfield", "label": null },
        "timings": { "dispatch": 12 },
        "auditIds": ["01AUDIT"],
    });
    // When
    sink.reply(Method::TypeText, Duration::from_micros(40), &Ok(report));
    sink.reply(
        Method::Click,
        Duration::from_micros(5),
        &Err(Failure::Engine(DesktopError::new(ErrorCode::ScreenLocked, "locked"))),
    );
    // Then
    let path = sink.path().expect("the trace is open");
    assert_eq!(path.parent().and_then(|parent| parent.file_name()), Some(std::ffi::OsStr::new("trace")));
    let lines = lines(&sink);
    assert_eq!((lines[0]["type"].clone(), lines[0]["schema"].clone()), (json!("trace.meta"), json!(SCHEMA)));
    assert_eq!(lines[1]["method"], json!("typeText"));
    assert_eq!(lines[1]["durationUs"], json!(40));
    assert_eq!(lines[1]["report"]["auditIds"], json!(["01AUDIT"]));
    assert_eq!(lines[1]["report"]["timings"], json!({ "dispatch": 12 }));
    assert_eq!((lines[2]["ok"].clone(), lines[2]["code"].clone()), (json!(false), json!("ScreenLocked")));
}

#[test]
fn trace_off_or_no_audit_path_writes_nothing() {
    // Given
    let dir = Scratch::new();
    let sink = TraceSink::new();
    // When
    sink.configure(&options(dir.path(), false));
    sink.configure(&DesktopSessionOptions { trace: true, ..DesktopSessionOptions::default() });
    sink.reply(Method::Click, Duration::ZERO, &Ok(Value::Null));
    // Then
    assert!(sink.path().is_none());
    assert!(!dir.path().join("trace").exists());
}

#[test]
fn reopening_the_same_trace_appends_without_a_second_meta_line() {
    // Given
    let dir = Scratch::new();
    let sink = TraceSink::new();
    sink.configure(&options(dir.path(), true));
    sink.stop();
    // When
    sink.configure(&options(dir.path(), true));
    sink.reply(Method::Click, Duration::ZERO, &Ok(Value::Null));
    // Then
    let metas = lines(&sink).iter().filter(|line| line["type"] == "trace.meta").count();
    assert_eq!(metas, 1);
}
