//! `trace: true` end to end against the engine binary: the JSONL trace
//! beside the audit log starts with `trace.meta`, carries per-stage timings,
//! and neither it nor the audit log holds the secret typed into a secure
//! field (`v2-trace-secure-field.json`).

mod common;

use std::path::{Path, PathBuf};

use common::{fake_backend, Engine};
use serde_json::{json, Value};

const SCENARIO: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../senpi-desktop-backend-fake/fixtures/v2-trace-secure-field.json"
);
const SECRET: &str = "hunter2-trace-secret-7731";

struct Scratch(PathBuf);

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Sends `request` and returns the reply, skipping the notifications it caused.
fn call(engine: &mut Engine, request: Value, messages: usize) -> Value {
    let id = request["id"].clone();
    engine.send(&request);
    let mut reply = Value::Null;
    for _ in 0..messages {
        let message = engine.next();
        if message["id"] == id {
            reply = message;
        }
    }
    reply
}

fn read_lines(path: &Path) -> Vec<Value> {
    std::fs::read_to_string(path)
        .expect("readable")
        .lines()
        .map(|line| serde_json::from_str(line).expect("JSONL"))
        .collect()
}

#[test]
fn a_traced_session_writes_a_redacted_jsonl_trace_beside_the_audit_log() {
    // Given
    let scratch = Scratch(std::env::temp_dir().join(format!("senpi-trace-e2e-{}", ulid::Ulid::generate())));
    std::fs::create_dir_all(&scratch.0).expect("scratch dir");
    let audit = scratch.0.join("audit.jsonl");
    let mut engine = Engine::spawn(&[fake_backend(SCENARIO), ("SENPI_DESKTOP_FAKE_CLOCK", "1".to_owned())]);
    let open = json!({ "jsonrpc": "2.0", "id": 1, "method": "session.open", "params": {
        "allowHostRelayOnlyStop": true, "showCursor": false, "reportMode": "object",
        "trace": true, "auditPath": audit,
    }});
    assert!(call(&mut engine, open, 1)["result"].is_object());
    let start = json!({ "jsonrpc": "2.0", "id": 2, "method": "stopPath.start", "params": { "chord": "ctrl+alt+shift+escape" } });
    call(&mut engine, start, 1);
    call(&mut engine, json!({ "jsonrpc": "2.0", "id": 3, "method": "stopPath.heartbeat", "params": {} }), 2);
    let capture = call(&mut engine, json!({ "jsonrpc": "2.0", "id": 4, "method": "capture", "params": { "target": "101" } }), 1);
    let frame = capture["result"]["frameId"].clone();
    // When
    let click = call(&mut engine, json!({ "jsonrpc": "2.0", "id": 5, "method": "click", "params": {
        "target": "101", "x": 20.0, "y": 20.0, "frameId": frame,
    }}), 2);
    let typed = call(&mut engine, json!({ "jsonrpc": "2.0", "id": 6, "method": "typeText", "params": {
        "target": "101", "text": SECRET,
    }}), 2);
    call(&mut engine, json!({ "jsonrpc": "2.0", "id": 7, "method": "session.close", "params": {} }), 1);
    drop(engine);
    // Then
    assert_eq!(click["result"]["hit"], json!({ "role": "textfield", "label": null }));
    assert!(click["result"]["timings"]["dispatch"].is_u64());
    assert!(typed["result"]["timings"]["dispatch"].is_u64());
    let traces: Vec<PathBuf> = std::fs::read_dir(scratch.0.join("trace"))
        .expect("the trace directory exists")
        .map(|entry| entry.expect("entry").path())
        .collect();
    assert_eq!(traces.len(), 1);
    let lines = read_lines(&traces[0]);
    assert_eq!((lines[0]["type"].clone(), lines[0]["schema"].clone()), (json!("trace.meta"), json!(1)));
    let typed_audit = lines
        .iter()
        .find(|line| line["type"] == "audit" && line["event"]["action"] == "typeText")
        .expect("the typeText audit is traced");
    assert_eq!(typed_audit["event"]["textLength"], json!(SECRET.chars().count()));
    assert_eq!(typed_audit["event"]["textSha256"].as_str().map(str::len), Some(16));
    let typed_reply = lines
        .iter()
        .find(|line| line["type"] == "reply" && line["method"] == "typeText")
        .expect("the typeText reply is traced");
    assert!(typed_reply["report"]["timings"]["dispatch"].is_u64());
    let written = format!("{}{}", std::fs::read_to_string(&traces[0]).unwrap(), std::fs::read_to_string(&audit).unwrap());
    assert_eq!(written.matches(SECRET).count(), 0);
    assert_eq!(written.matches("Password").count(), 0);
}

#[test]
fn an_untraced_session_reports_no_timings_and_writes_no_trace() {
    // Given
    let scratch = Scratch(std::env::temp_dir().join(format!("senpi-trace-off-{}", ulid::Ulid::generate())));
    std::fs::create_dir_all(&scratch.0).expect("scratch dir");
    let mut engine = Engine::spawn(&[fake_backend(SCENARIO), ("SENPI_DESKTOP_FAKE_CLOCK", "1".to_owned())]);
    let open = json!({ "jsonrpc": "2.0", "id": 1, "method": "session.open", "params": {
        "allowHostRelayOnlyStop": true, "showCursor": false, "reportMode": "object",
        "auditPath": scratch.0.join("audit.jsonl"),
    }});
    call(&mut engine, open, 1);
    let start = json!({ "jsonrpc": "2.0", "id": 2, "method": "stopPath.start", "params": { "chord": "ctrl+alt+shift+escape" } });
    call(&mut engine, start, 1);
    call(&mut engine, json!({ "jsonrpc": "2.0", "id": 3, "method": "stopPath.heartbeat", "params": {} }), 2);
    // When
    let typed = call(&mut engine, json!({ "jsonrpc": "2.0", "id": 4, "method": "typeText", "params": {
        "target": "101", "text": SECRET,
    }}), 2);
    drop(engine);
    // Then
    assert!(typed["result"]["disposition"].is_object());
    assert!(typed["result"].get("timings").is_none());
    assert!(!scratch.0.join("trace").exists());
}
