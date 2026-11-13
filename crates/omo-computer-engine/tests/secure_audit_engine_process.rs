//! Planner ruling R38: the no-digest audit of a secure-focused type is proved through the REAL
//! engine process, not in process. Each test spawns this crate's own binary (cargo builds it
//! for integration tests: `CARGO_BIN_EXE_omo-computer-engine`) with `--stdio` over a fresh
//! runtime root, sends the steps of `v3-secure-field-type-audit-length-only-no-hash.json`,
//! closes stdin, waits for the exit and then reads the hand's `audit.jsonl`, its pre-input
//! marker and every other file the engine left under the root (the trace included, once a
//! trace writer writes one there).
//!
//! The needle is `sha256_16(secret)`: the first 16 lowercase hex digits of SHA-256 over the
//! secret's UTF-8 bytes, computed here independently of the engine's own helper. The secure
//! legs (a focused secure field, and OS-wide Secure Input) count 0 of it; the positive
//! control types the same text into a NON-secure field and finds it in the audit, so the grep
//! is shown able to see a digest when one is there.

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
const SECURE_INPUT_SCENARIO: &str =
    "crates/omo-computer-backend-fake/fixtures/v3-secure-input-on.json";
const REPLY_TIMEOUT: Duration = Duration::from_secs(10);
const AUDIT: &str = "audit/computer/local/audit.jsonl";
const MARKER: &str = "markers/local/default.json";
/// Every fake persona: the secure legs run on each through the engine process.
const PERSONAS: [&str; 4] = ["macos", "x11", "wayland", "win32"];

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// The engine binary cargo built for this integration test.
fn engine() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_omo-computer-engine"))
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
    /// `<root>/fake-sink-<engine pid>.log`: the one file the engine's fake backend records
    /// its delivered input to (engine `route.rs`, `SINK_FILE_PREFIX` + the process id).
    sink_path: PathBuf,
}

impl Left {
    /// An engine-state file that MUST exist and be non-empty: a missing one fails the test,
    /// never reads as clean.
    fn state(&self, relative: &str) -> String {
        let path = self.root.path().join(relative);
        let text = fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("engine state {} is missing: {error}", path.display()));
        assert!(!text.trim().is_empty(), "empty: {}", path.display());
        text
    }

    fn marker(&self) -> Value {
        serde_json::from_str(&self.state(MARKER)).expect("the marker is JSON")
    }

    /// Every file under the root, by path; a directory entry that cannot be read fails.
    fn files(&self) -> Vec<PathBuf> {
        let mut files = Vec::new();
        let mut stack = vec![self.root.path().to_owned()];
        while let Some(dir) = stack.pop() {
            for entry in fs::read_dir(&dir).expect("a readable dir") {
                let path = entry.expect("a readable dir entry").path();
                if path.is_dir() {
                    stack.push(path);
                } else {
                    files.push(path);
                }
            }
        }
        files
    }

    /// Every file under the root but the audit and the marker (read on their own): any other
    /// engine state and anything new that appears. Exactly ONE file is excluded, by its exact
    /// path: `sink_path`, the fake backend's SIMULATED KEYBOARD, which records each delivered
    /// event (`text "<typed>"`, fake `desktop.rs`) and so must hold the typed text: typing a
    /// secret into a secure field still delivers it. `sink()` reads it, and each test asserts
    /// the delivery there, so the exclusion cannot hide a missing one.
    fn rest(&self) -> String {
        let skip = [AUDIT, MARKER].map(|relative| self.root.path().join(relative));
        let mut text = String::new();
        let others = self.files().into_iter();
        for path in others.filter(|path| !skip.contains(path) && *path != self.sink_path) {
            let bytes =
                fs::read(&path).unwrap_or_else(|error| panic!("{}: {error}", path.display()));
            text.push_str(&String::from_utf8_lossy(&bytes));
        }
        text
    }

    /// Occurrences of `needle` in [the audit, the marker, every other file] (see `rest`).
    fn on_disk(&self, needle: &str) -> [usize; 3] {
        [self.state(AUDIT), self.state(MARKER), self.rest()]
            .map(|text| text.matches(needle).count())
    }

    /// The trace: this engine writes NONE. The v3 engine has no session trace writer yet
    /// (DEFERRED-LEGS C1, owed to row 20), so no file or directory under the root may be one.
    /// The day a trace appears this fails, and the trace must then be read, asserted
    /// non-empty and grepped here like the audit and the marker.
    fn assert_no_trace(&self) {
        let traces: Vec<PathBuf> = self
            .files()
            .into_iter()
            .filter(|path| {
                let relative = path.strip_prefix(self.root.path()).unwrap_or(path);
                relative.to_string_lossy().contains("trace")
                    || relative.starts_with("senpi-computer-sessions")
            })
            .collect();
        assert!(traces.is_empty(), "grep the trace too: {traces:?}");
    }

    fn sink(&self) -> String {
        fs::read_to_string(&self.sink_path).expect("the engine's fake sink file")
    }

    fn typed_line(&self) -> Value {
        let lines: Vec<Value> = self
            .state(AUDIT)
            .lines()
            .map(|line| serde_json::from_str(line).expect("an audit line is JSON"))
            .filter(|line: &Value| line["action"] == "typeText")
            .collect();
        assert_eq!(lines.len(), 1, "one typeText audit line: {lines:?}");
        lines[0].clone()
    }
}

/// `scenario` with the fake's `persona` field set, written under `dir` (outside the root).
fn as_persona(scenario: &str, persona: &str, dir: &Path) -> PathBuf {
    let text = fs::read_to_string(repo().join(scenario)).expect("the scenario");
    let mut json: Value = serde_json::from_str(&text).expect("scenario JSON");
    json["persona"] = json!(persona);
    let path = dir.join(format!("{persona}.json"));
    fs::write(&path, json.to_string()).expect("the persona scenario");
    path
}

/// Runs the case's steps on a fresh engine process over `scenario`, one reply per step, and
/// checks the typeText was delivered.
fn run_engine(case: &Value, scenario: &Path) -> Left {
    let root = tempfile::tempdir().expect("runtime root");
    let mut command = Command::new(engine());
    command
        .arg("--stdio")
        .current_dir(repo())
        .env_clear()
        .envs(std::env::vars().filter(|(name, _)| !name.starts_with("OMO_COMPUTER_")))
        .env("OMO_COMPUTER_BACKEND", "fake")
        .env("OMO_COMPUTER_RUNTIME_DIR", root.path())
        .env("OMO_COMPUTER_FAKE_SCENARIO", scenario)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    for (name, value) in case["env"].as_object().expect("case env") {
        command.env(name, value.as_str().expect("an env string"));
    }
    let mut child = command.spawn().expect("the engine spawns");
    let sink_path = root.path().join(format!("fake-sink-{}.log", child.id()));
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
    let mut typed = Value::Null;
    for step in case["steps"].as_array().expect("steps") {
        writeln!(stdin, "{}", step["send"]).expect("a request line");
        stdin.flush().expect("flushed");
        let line = replies
            .recv_timeout(REPLY_TIMEOUT)
            .expect("a reply within the bound");
        if step["send"]["method"] == "typeText" {
            typed = serde_json::from_str(&line).expect("a reply is JSON");
        }
    }
    drop(stdin);
    let status = child.wait().expect("the engine exits");
    reader.join().expect("the reader ends");
    assert!(status.success(), "engine exit: {status}");
    let delivered = typed["result"].is_null() && typed.get("error").is_none();
    assert!(delivered, "delivered: {typed}");
    Left { root, sink_path }
}

/// The case's type into a secure context on `scenario`, on every fake persona: length
/// only, `redacted_secure`, no digest and no text in the audit, the marker or any other file.
fn assert_length_only(case: &Value, scenario: &str) {
    let secret = secret(case);
    let needle = sha256_16(&secret);
    let personas = tempfile::tempdir().expect("persona scenarios");
    let length = json!({ "length": secret.chars().count() });
    let redacted = json!(["redacted_secure"]);
    for persona in PERSONAS {
        let left = run_engine(case, &as_persona(scenario, persona, personas.path()));
        let (typed, marker) = (left.typed_line(), left.marker());
        let got = [
            &typed["text"],
            &marker["text"],
            &typed["warnings"],
            &marker["warnings"],
        ];
        assert_eq!(got, [&length, &length, &redacted, &redacted], "{persona}");
        left.assert_no_trace();
        // [digest, secret] x [audit, marker, rest]: all zero.
        let counts = [left.on_disk(&needle), left.on_disk(&secret)];
        assert_eq!(counts, [[0; 3]; 2], "{persona}: {needle}");
        assert!(left.sink().contains(&secret), "{persona}: no delivery");
    }
}

#[test]
fn engine_process_secure_type_leaves_no_digest_in_audit_marker_or_trace() {
    let case = case();
    assert_length_only(&case, case["scenario"].as_str().expect("scenario"));
}

/// The same type under OS-wide Secure Input (`secure_input_on`), no secure field focused.
#[test]
fn engine_process_secure_input_type_leaves_no_digest_in_audit_marker_or_trace() {
    assert_length_only(&case(), SECURE_INPUT_SCENARIO);
}

#[test]
fn engine_process_plain_type_keeps_the_digest_the_grep_looks_for() {
    let case = case();
    let secret = secret(&case);
    let digest = sha256_16(&secret);
    let left = run_engine(&case, &repo().join(PLAIN_SCENARIO));
    let (typed, marker) = (left.typed_line(), left.marker());
    let got = [&typed["text"]["sha256_16"], &marker["text"]["sha256_16"]];
    assert_eq!(got, [&json!(digest), &json!(digest)]);
    // The grep sees a digest when one is there: in the audit and the marker.
    assert_eq!(
        left.on_disk(&digest).map(|count| count > 0),
        [true, true, false]
    );
    left.assert_no_trace();
    assert_eq!(
        left.on_disk(&secret),
        [0; 3],
        "the plain text is never on disk"
    );
    assert!(left.sink().contains(&secret), "no delivery");
}
