//! The opt-in request trace of a session opened with `trace: true` and an
//! `auditPath`: an append-only JSONL file `<audit dir>/trace/<pid>-<start>.jsonl`
//! whose first line is `trace.meta`. It records ids, codes and durations;
//! every member that can carry user content passes [`redact`] first
//! (DESIGN §8): under a `secure: true` object it is `null`, typed text keeps
//! only its length and hash, and any other string is cut at 256 characters.
//! A write failure goes to stderr and never fails the request.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use parking_lot::Mutex;
use senpi_desktop_core::methods::Method;
use senpi_desktop_core::protocol::{ABI, PROTOCOL_VERSION};
use senpi_desktop_core::protocol_results::AuditEvent;
use senpi_desktop_core::types::DesktopSessionOptions;
use senpi_desktop_session::Op;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use crate::rpc::Failure;

/// `trace.meta.schema` of the lines this engine writes.
pub const SCHEMA: u32 = 1;

/// Longest string a trace line keeps before it is cut.
const MAX_CHARS: usize = 256;

/// Members the redaction table covers; `text` is typed text. `note` is
/// free-form; `warning` is a token set today but is covered the same way.
const REDACTED: [&str; 7] = ["text", "value", "title", "label", "url", "note", "warning"];

pub struct TraceSink {
    started_unix_ms: u64,
    file: Mutex<Option<(PathBuf, File)>>,
}

impl TraceSink {
    pub fn new() -> Self {
        Self {
            started_unix_ms: unix_now_ms(),
            file: Mutex::new(None),
        }
    }

    /// Applies an open the session accepted: `trace: true` with an
    /// `auditPath` traces into that audit directory, anything else stops.
    pub fn configure(&self, options: &DesktopSessionOptions) {
        let wanted = options
            .audit_path
            .as_deref()
            .filter(|_| options.trace)
            .map(|audit| self.path_for(audit));
        let mut file = self.file.lock();
        if file.as_ref().map(|(path, _)| path) == wanted.as_ref() {
            return;
        }
        *file = wanted.and_then(|path| match open(&path, self.started_unix_ms) {
            Ok(opened) => Some((path, opened)),
            Err(error) => {
                eprintln!("senpi-desktop-engine: trace file {} cannot be opened: {error}", path.display());
                None
            }
        });
    }

    pub fn stop(&self) {
        *self.file.lock() = None;
    }

    #[cfg(test)]
    pub fn path(&self) -> Option<PathBuf> {
        self.file.lock().as_ref().map(|(path, _)| path.clone())
    }

    fn path_for(&self, audit: &Path) -> PathBuf {
        let dir = audit.parent().unwrap_or_else(|| Path::new("."));
        dir.join("trace")
            .join(format!("{}-{}.jsonl", std::process::id(), self.started_unix_ms))
    }

    /// One line per `audit` notification.
    pub fn audit(&self, event: &AuditEvent) {
        self.write(|| json!({ "type": "audit", "event": event }));
    }

    /// One line per session request: its method, duration and outcome, plus
    /// the action report it answered (ids only, no audit body).
    pub fn reply(&self, method: Method, elapsed: Duration, outcome: &Result<Value, Failure>) {
        self.write(|| {
            let mut line = Map::new();
            line.insert("type".to_owned(), json!("reply"));
            line.insert("method".to_owned(), json!(method.spec().name));
            line.insert("durationUs".to_owned(), json!(u64::try_from(elapsed.as_micros()).unwrap_or(u64::MAX)));
            line.insert("ok".to_owned(), json!(outcome.is_ok()));
            match outcome {
                Ok(result) => {
                    if let Some(report) = action_report(result) {
                        line.insert("report".to_owned(), report.clone());
                    }
                }
                Err(Failure::Engine(error)) => {
                    line.insert("code".to_owned(), json!(error.code));
                }
                Err(_) => {}
            }
            Value::Object(line)
        });
    }

    fn write(&self, line: impl FnOnce() -> Value) {
        let mut file = self.file.lock();
        let Some((path, opened)) = file.as_mut() else {
            return;
        };
        let mut line = line();
        redact(&mut line);
        if let Some(members) = line.as_object_mut() {
            members.insert("atMs".to_owned(), json!(unix_now_ms()));
        }
        if let Err(error) = write_line(opened, &line) {
            eprintln!("senpi-desktop-engine: trace write failed ({}): {error}", path.display());
        }
    }
}

/// The report of an action reply: the result itself (exec methods) or its
/// `report` (`ax.setValue`, `ax.typeText`).
fn action_report(result: &Value) -> Option<&Value> {
    if result.get("auditIds").is_some() {
        return Some(result);
    }
    result.get("report").filter(|report| report.is_object())
}

fn open(path: &Path, started_unix_ms: u64) -> std::io::Result<File> {
    if let Some(dir) = path.parent() {
        let mut builder = std::fs::DirBuilder::new();
        builder.recursive(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(dir)?;
    }
    let mut options = OpenOptions::new();
    options.append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    if !path.exists() {
        publish_meta(path, &options, started_unix_ms)?;
    }
    options.open(path)
}

/// Writes `trace.meta` to a staged file and hard-links it into place, so
/// the trace never exists without its first line and two engines sharing
/// a name write it once: the second link fails with `AlreadyExists`.
fn publish_meta(path: &Path, options: &OpenOptions, started_unix_ms: u64) -> std::io::Result<()> {
    static STAGED: AtomicU64 = AtomicU64::new(0);
    let staged = path.with_extension(format!(
        "{}-{}.meta",
        std::process::id(),
        STAGED.fetch_add(1, Ordering::Relaxed)
    ));
    let mut file = options.clone().create_new(true).open(&staged)?;
    let meta = json!({
        "type": "trace.meta",
        "schema": SCHEMA,
        "pid": std::process::id(),
        "startedAtMs": started_unix_ms,
        "engineVersion": env!("CARGO_PKG_VERSION"),
        "protocolVersion": PROTOCOL_VERSION,
        "abi": ABI,
    });
    let linked = write_line(&mut file, &meta).and_then(|()| std::fs::hard_link(&staged, path));
    std::fs::remove_file(&staged)?;
    match linked {
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
        linked => linked,
    }
}

/// Writes `line` and its newline with one `write_all`, so lines from
/// writers appending to the same file never interleave.
fn write_line(file: &mut File, line: &Value) -> std::io::Result<()> {
    let mut text = line.to_string();
    text.push('\n');
    file.write_all(text.as_bytes())
}

/// Applies the redaction table to every member of `value`.
pub fn redact(value: &mut Value) {
    redact_within(value, false);
}

fn redact_within(value: &mut Value, secure: bool) {
    match value {
        Value::Object(members) => {
            let secure = secure || members.get("secure") == Some(&Value::Bool(true));
            for (key, member) in members.iter_mut() {
                if REDACTED.contains(&key.as_str()) {
                    redact_member(key, member, secure);
                } else {
                    redact_within(member, secure);
                }
            }
        }
        Value::Array(items) => items.iter_mut().for_each(|item| redact_within(item, secure)),
        _ => {}
    }
}

fn redact_member(key: &str, member: &mut Value, secure: bool) {
    if secure {
        *member = Value::Null;
        return;
    }
    let Value::String(text) = member else {
        redact_within(member, secure);
        return;
    };
    *member = if key == "text" {
        json!({ "length": text.chars().count(), "sha256": sha256_prefix(text) })
    } else if text.chars().count() > MAX_CHARS {
        Value::String(format!("{}[truncated]", text.chars().take(MAX_CHARS).collect::<String>()))
    } else {
        return;
    };
}

/// First 16 hex digits, as the audit log hashes typed text.
fn sha256_prefix(text: &str) -> String {
    Sha256::digest(text.as_bytes())
        .iter()
        .take(8)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn unix_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

/// The engine method a session request answers.
pub const fn op_method(op: &Op) -> Method {
    match op {
        Op::Displays => Method::Displays,
        Op::Windows => Method::Windows,
        Op::Capture(_) => Method::Capture,
        Op::Observe(_) => Method::Observe,
        Op::CaptureRegion(_) => Method::CaptureRegion,
        Op::Click(_) => Method::Click,
        Op::MoveMouse(_) => Method::MoveMouse,
        Op::Drag(_) => Method::Drag,
        Op::Scroll(_) => Method::Scroll,
        Op::TypeText(_) => Method::TypeText,
        Op::KeyChord(_) => Method::KeyChord,
        Op::HoldKeys(_) => Method::HoldKeys,
        Op::HoldMouse(_) => Method::HoldMouse,
        Op::RaiseWindow(_) => Method::RaiseWindow,
        Op::AxSnapshot(_) => Method::AxSnapshot,
        Op::AxQuery(_) => Method::AxQuery,
        Op::AxElementAt(_) => Method::AxElementAt,
        Op::AxFocused => Method::AxFocused,
        Op::AxNode(_) => Method::AxNode,
        Op::AxAttributes(_) => Method::AxAttributes,
        Op::AxChildren(_) => Method::AxChildren,
        Op::AxParent(_) => Method::AxParent,
        Op::AxPerform(_) => Method::AxPerform,
        Op::AxSetValue(_) => Method::AxSetValue,
        Op::AxFocus(_) => Method::AxFocus,
        Op::AxClick(_) => Method::AxClick,
        Op::AxTypeText(_) => Method::AxTypeText,
        Op::ClipboardRead => Method::ClipboardRead,
        Op::ClipboardWrite(_) => Method::ClipboardWrite,
        Op::ControlGrant(_) => Method::ControlGrant,
        Op::ControlRevoke => Method::ControlRevoke,
        Op::ControlState => Method::ControlState,
        Op::MenuItems(_) => Method::MenusItems,
        Op::MenusSelect(_) => Method::MenusSelect,
    }
}

#[cfg(test)]
#[path = "trace_tests.rs"]
mod tests;
