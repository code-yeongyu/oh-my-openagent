//! Planner ruling R38: the no-digest audit of a secure-focused type is proved through the REAL
//! engine process, not in process. Each test spawns the built `omo-computer-engine --stdio`
//! (`$CARGO_TARGET_DIR/debug`, else `<repo>/target/debug`; build it first with
//! `cargo build -p omo-computer-engine`) over a fresh runtime root, sends the steps of
//! `v3-secure-field-type-audit-length-only-no-hash.json`, closes stdin, waits for the exit and
//! then reads the hand's `audit.jsonl`, its pre-input marker and every other file the engine
//! left under the root (the trace included, once a trace writer writes one there).
//!
//! The needle is `sha256_16(secret)`: the first 16 lowercase hex digits of SHA-256 over the
//! secret's UTF-8 bytes, computed here independently of the engine's own helper. The secure
//! leg counts 0 of it; the positive control types the same text into a NON-secure field and
//! finds it in the audit, so the grep is shown able to see a digest when one is there.

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;
use std::{fs, thread};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const CASE: &str = "crates/omo-computer-core/fixtures/conformance/v3-secure-field-type-audit-length-only-no-hash.json";
const PLAIN_SCENARIO: &str =
    "crates/omo-computer-backend-fake/fixtures/two-displays-one-window.json";
const REPLY_TIMEOUT: Duration = Duration::from_secs(10);

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// The engine binary the replay driver of row 15 runs.
fn engine() -> PathBuf {
    let target = std::env::var_os("CARGO_TARGET_DIR")
        .filter(|dir| !dir.is_empty())
        .map_or_else(|| repo().join("target"), PathBuf::from);
    let path = target.join("debug").join(format!(
        "omo-computer-engine{}",
        std::env::consts::EXE_SUFFIX
    ));
    assert!(
        path.is_file(),
        "no engine at {} - run `cargo build -p omo-computer-engine` first",
        path.display()
    );
    path
}

fn sha256_16(text: &str) -> String {
    Sha256::digest(text.as_bytes())
        .iter()
        .take(8)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn case() -> Value {
    serde_json::from_str(&fs::read_to_string(repo().join(CASE)).expect("the case"))
        .expect("case JSON")
}

fn secret(case: &Value) -> String {
    case["steps"]
        .as_array()
        .expect("steps")
        .iter()
        .find(|step| step["send"]["method"] == "typeText")
        .and_then(|step| step["send"]["params"]["text"].as_str())
        .expect("the case types a secret")
        .to_owned()
}

/// What one engine process left behind.
struct Left {
    root: tempfile::TempDir,
    typed_reply: Value,
}

impl Left {
    fn read(&self, relative: &str) -> String {
        fs::read_to_string(self.root.path().join(relative)).unwrap_or_default()
    }

    fn audit(&self) -> String {
        self.read("audit/computer/local/audit.jsonl")
    }

    fn marker(&self) -> String {
        self.read("markers/local/default.json")
    }

    /// Every file under the root but the audit and the marker: the trace and anything else.
    fn rest(&self) -> String {
        let skip = [
            self.root.path().join("audit/computer/local/audit.jsonl"),
            self.root.path().join("markers/local/default.json"),
        ];
        let mut text = String::new();
        let mut stack = vec![self.root.path().to_owned()];
        while let Some(dir) = stack.pop() {
            for entry in fs::read_dir(dir).expect("readable").filter_map(Result::ok) {
                let path = entry.path();
                if path.is_dir() {
                    stack.push(path);
                } else if !skip.contains(&path) {
                    text.push_str(&String::from_utf8_lossy(
                        &fs::read(&path).unwrap_or_default(),
                    ));
                }
            }
        }
        text
    }

    fn typed_line(&self) -> Value {
        let lines: Vec<Value> = self
            .audit()
            .lines()
            .map(|line| serde_json::from_str(line).expect("an audit line is JSON"))
            .filter(|line: &Value| line["action"] == "typeText")
            .collect();
        assert_eq!(lines.len(), 1, "one typeText audit line: {lines:?}");
        lines[0].clone()
    }
}

/// Runs the case's steps on a fresh engine process over `scenario`, one reply per step.
fn run_engine(case: &Value, scenario: &str) -> Left {
    let root = tempfile::tempdir().expect("runtime root");
    let mut command = Command::new(engine());
    command
        .arg("--stdio")
        .current_dir(repo())
        .env_clear()
        .envs(std::env::vars().filter(|(name, _)| !name.starts_with("OMO_COMPUTER_")))
        .env("OMO_COMPUTER_BACKEND", "fake")
        .env("OMO_COMPUTER_RUNTIME_DIR", root.path())
        .env("OMO_COMPUTER_FAKE_SCENARIO", repo().join(scenario))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    for (name, value) in case["env"].as_object().expect("case env") {
        command.env(name, value.as_str().expect("an env string"));
    }
    let mut child = command.spawn().expect("the engine spawns");
    let mut stdin = child.stdin.take().expect("stdin");
    let stdout = child.stdout.take().expect("stdout");
    let (lines, replies) = mpsc::channel();
    let reader = thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if lines.send(line).is_err() {
                break;
            }
        }
    });
    let mut typed_reply = Value::Null;
    for step in case["steps"].as_array().expect("steps") {
        writeln!(stdin, "{}", step["send"]).expect("a request line");
        stdin.flush().expect("flushed");
        let line = replies
            .recv_timeout(REPLY_TIMEOUT)
            .expect("the engine replies within the bound");
        let reply: Value = serde_json::from_str(&line).expect("a reply is JSON");
        if step["send"]["method"] == "typeText" {
            typed_reply = reply;
        }
    }
    drop(stdin);
    let status = child.wait().expect("the engine exits");
    reader.join().expect("the reader ends");
    assert!(
        status.success(),
        "the engine exits 0 at stdin close: {status}"
    );
    Left { root, typed_reply }
}

fn delivered(left: &Left) {
    assert_eq!(
        left.typed_reply["result"],
        Value::Null,
        "{}",
        left.typed_reply
    );
    assert!(
        left.typed_reply.get("error").is_none(),
        "{}",
        left.typed_reply
    );
}

#[test]
#[ignore = "UNOBSERVED at row 17: no backend reports a secure focus through the Backend trait, so the stdio engine's SecureInputProbe never fires (DEFERRED-LEGS C14, owed to row 26); run with --ignored to observe the RED"]
fn engine_process_secure_type_leaves_no_digest_in_audit_marker_or_trace() {
    let case = case();
    let secret = secret(&case);
    let needle = sha256_16(&secret);
    let scenario = case["scenario"]
        .as_str()
        .expect("the case's secure scenario");
    let left = run_engine(&case, scenario);
    delivered(&left);
    let typed = left.typed_line();
    let counts = [
        ("audit", left.audit().matches(&needle).count()),
        ("marker", left.marker().matches(&needle).count()),
        ("trace and the rest", left.rest().matches(&needle).count()),
    ];
    assert_eq!(
        counts,
        [("audit", 0), ("marker", 0), ("trace and the rest", 0)],
        "sha256_16(secret) = {needle} on disk; typeText line {typed}"
    );
    let everything = [left.audit(), left.marker(), left.rest()].concat();
    assert_eq!(
        everything.matches(&secret).count(),
        0,
        "the secret is on disk"
    );
    assert_eq!(
        typed["text"],
        json!({ "length": secret.chars().count() }),
        "{typed}"
    );
    assert_eq!(typed["warnings"], json!(["redacted_secure"]), "{typed}");
}

#[test]
fn engine_process_plain_type_keeps_the_digest_the_grep_looks_for() {
    let case = case();
    let secret = secret(&case);
    let needle = sha256_16(&secret);
    let left = run_engine(&case, PLAIN_SCENARIO);
    delivered(&left);
    let typed = left.typed_line();
    assert_eq!(typed["text"]["sha256_16"], json!(needle), "{typed}");
    assert!(
        left.audit().matches(&needle).count() >= 1,
        "the grep sees the digest"
    );
    assert_eq!(
        [left.audit(), left.marker(), left.rest()]
            .concat()
            .matches(&secret)
            .count(),
        0,
        "the plain text itself is never on disk"
    );
}
