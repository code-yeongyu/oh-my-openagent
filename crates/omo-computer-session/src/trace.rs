//! The trace behind `computer.trace`: `false` writes nothing, `true` the JSONL trace only,
//! `"full"` the session dir `senpi-computer-sessions/<id>/` under the artifact dir with
//! `manifest.json` (exactly `id`, `created_at`, `ended_at`, `trace`, `artifacts`,
//! `cursor_overlay`) and one `turn-NNNNN/` per exec call holding `action.json` and the frame
//! the call consumed. The manifest is rewritten atomically after each turn; once the session
//! ended, nothing more is written.

use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use omo_computer_core::methods::Method;
use omo_computer_core::requests::TraceMode;
use omo_computer_core::results::ExecReply;
use serde_json::{json, Value};

use crate::audit::gc::{ARTIFACT_PREFIX, SESSIONS_DIR};
use crate::audit::rfc3339_ms;
use crate::{Refused, Session};

/// The trace of one session.
#[derive(Debug)]
pub struct Trace {
    mode: TraceMode,
    dir: Option<PathBuf>,
    id: String,
    created_ms: u64,
    ended_ms: Option<u64>,
    turns: u32,
    artifacts: Vec<String>,
    /// The latest frame bytes per target (`"full"` only).
    frames: HashMap<String, Vec<u8>>,
}

impl Default for Trace {
    fn default() -> Self {
        Self {
            mode: TraceMode::Off,
            dir: None,
            id: String::new(),
            created_ms: 0,
            ended_ms: None,
            turns: 0,
            artifacts: Vec::new(),
            frames: HashMap::new(),
        }
    }
}

/// One exec call as the trace records it.
pub struct Turn<'a> {
    pub method: &'a str,
    /// The call's params as dispatched.
    pub params: Value,
    /// The frame key the call aimed at.
    pub target: &'a str,
    /// The reply (`result` or `error`).
    pub outcome: Value,
}

fn write_new(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

impl Trace {
    /// The trace a session opened with `mode` writes under `dir` (the artifact dir); a session
    /// without one writes nothing.
    #[must_use]
    pub fn open(mode: TraceMode, dir: Option<PathBuf>, id: &str, now_ms: u64) -> Self {
        Self {
            mode,
            dir,
            id: id.to_owned(),
            created_ms: now_ms,
            ..Self::default()
        }
    }

    /// The JSONL trace file.
    #[must_use]
    pub fn jsonl_path(&self) -> Option<PathBuf> {
        self.dir
            .as_ref()
            .map(|dir| dir.join(format!("{ARTIFACT_PREFIX}trace-{}.jsonl", self.id)))
    }

    /// The `"full"` session dir.
    #[must_use]
    pub fn session_dir(&self) -> Option<PathBuf> {
        self.dir
            .as_ref()
            .map(|dir| dir.join(SESSIONS_DIR).join(&self.id))
    }

    /// Keeps the latest frame of `target` for the next turn on it (`"full"` only).
    pub(crate) fn remember_frame(&mut self, target: &str, png: &[u8]) {
        if self.mode == TraceMode::Full && self.ended_ms.is_none() {
            self.frames.insert(target.to_owned(), png.to_vec());
        }
    }

    /// Records one exec call.
    ///
    /// # Errors
    /// The trace file or session dir cannot be written.
    pub fn turn(&mut self, turn: &Turn<'_>) -> io::Result<()> {
        if self.mode == TraceMode::Off || self.ended_ms.is_some() || self.dir.is_none() {
            return Ok(());
        }
        self.turns += 1;
        let action = json!({
            "turn": self.turns,
            "method": turn.method,
            "params": turn.params,
            "target": turn.target,
            "outcome": turn.outcome,
        });
        match self.mode {
            TraceMode::Off => Ok(()),
            TraceMode::Jsonl => self.append_jsonl(&action),
            TraceMode::Full => self.write_turn(&action, turn.target),
        }
    }

    fn append_jsonl(&self, action: &Value) -> io::Result<()> {
        let Some(path) = self.jsonl_path() else {
            return Ok(());
        };
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut file = OpenOptions::new().create(true).append(true).open(path)?;
        writeln!(file, "{action}")
    }

    fn write_turn(&mut self, action: &Value, target: &str) -> io::Result<()> {
        let Some(session) = self.session_dir() else {
            return Ok(());
        };
        let name = format!("turn-{:05}", self.turns);
        let dir = session.join(&name);
        fs::create_dir_all(&dir)?;
        let text = serde_json::to_vec_pretty(action).map_err(io::Error::other)?;
        write_new(&dir.join("action.json"), &text)?;
        self.artifacts.push(format!("{name}/action.json"));
        if let Some(png) = self.frames.get(target) {
            write_new(&dir.join("frame.png"), png)?;
            self.artifacts.push(format!("{name}/frame.png"));
        }
        self.write_manifest()
    }

    fn manifest(&self) -> Value {
        json!({
            "id": self.id,
            "created_at": rfc3339_ms(self.created_ms),
            "ended_at": self.ended_ms.map(rfc3339_ms),
            "trace": "full",
            "artifacts": self.artifacts,
            "cursor_overlay": false,
        })
    }

    /// Rewrites `manifest.json` through a fresh temp file and a rename.
    fn write_manifest(&self) -> io::Result<()> {
        let Some(session) = self.session_dir() else {
            return Ok(());
        };
        fs::create_dir_all(&session)?;
        let text = serde_json::to_vec_pretty(&self.manifest()).map_err(io::Error::other)?;
        let temp = session.join(format!("manifest.json.tmp-{}", self.turns));
        let _ = fs::remove_file(&temp);
        write_new(&temp, &text)?;
        fs::rename(&temp, session.join("manifest.json"))
    }

    /// `session.close`: sets `ended_at`; the manifest is final from here on.
    ///
    /// # Errors
    /// The manifest cannot be rewritten.
    pub fn close(&mut self, now_ms: u64) -> io::Result<()> {
        if self.ended_ms.is_some() {
            return Ok(());
        }
        self.ended_ms = Some(now_ms);
        self.frames.clear();
        if self.mode == TraceMode::Full && self.dir.is_some() {
            self.write_manifest()
        } else {
            Ok(())
        }
    }
}

impl Session {
    /// Records one exec call in the session's trace; a write failure warns and never fails
    /// the call.
    pub(crate) fn trace_turn(
        &mut self,
        method: Method,
        params: Value,
        target: &str,
        result: &Result<ExecReply, Refused>,
    ) {
        let outcome = match result {
            Ok(reply) => json!({ "result": reply }),
            Err(refused) => json!({ "error": {
                "code": refused.refusal.code.wire(),
                "reason": refused.refusal.reason,
                "callId": refused.call_id,
            } }),
        };
        let turn = Turn {
            method: method.spec().name,
            params,
            target,
            outcome,
        };
        if let Err(error) = self.trace.turn(&turn) {
            eprintln!("omo-computer-engine: warn trace turn not written: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    use omo_computer_backend_fake::{
        FakeBackend, FakeClock, FakeScenario, RecordingSink, StopPathScript,
    };
    use omo_computer_core::params::SessionOpenParams;
    use omo_computer_core::paths::Roots;
    use serde_json::{json, Value};

    use crate::audit::gc::SESSIONS_DIR;
    use crate::Session;

    const SCENARIO: &str =
        include_str!("../../omo-computer-backend-fake/fixtures/two-displays-one-window.json");

    fn params<T: serde::de::DeserializeOwned>(value: Value) -> T {
        serde_json::from_value(value).expect("params parse")
    }

    /// One engine session opened with `trace`: a capture, one click, then close.
    fn run(trace: Value) -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("tempdir");
        let roots = Roots {
            state: dir.path().to_owned(),
            runtime: dir.path().to_owned(),
        };
        let scenario = FakeScenario::from_json(SCENARIO).expect("scenario");
        let backend =
            FakeBackend::with_parts(scenario, FakeClock::default(), RecordingSink::default())
                .with_stop_path(StopPathScript::Live);
        let mut session = Session::for_roots(Box::new(backend), &roots);
        let open: SessionOpenParams = params(json!({ "trace": trace }));
        session.open(open).expect("open");
        session.stop_path_start(params(json!({})));
        session.capture_frame("101", true, None).expect("a frame");
        session
            .click(params(json!({"target": "101", "x": 10, "y": 10})))
            .expect("delivered");
        session.close();
        dir
    }

    fn names(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir)
            .map(|entries| {
                entries
                    .filter_map(Result::ok)
                    .map(|entry| entry.file_name().to_string_lossy().into_owned())
                    .collect()
            })
            .unwrap_or_default();
        names.sort();
        names
    }

    #[test]
    fn trace_full_literal_accepted_true_is_jsonl_only() {
        let jsonl_run = run(json!(true));
        let artifacts = jsonl_run.path().join("artifacts");
        let listed = names(&artifacts);
        let jsonl: Vec<&String> = listed
            .iter()
            .filter(|name| name.ends_with(".jsonl"))
            .collect();
        assert_eq!(jsonl.len(), 1, "{listed:?}");
        assert!(
            !artifacts.join(SESSIONS_DIR).exists(),
            "true writes no session dir: {listed:?}"
        );
        let text = fs::read_to_string(artifacts.join(jsonl[0])).expect("the JSONL trace");
        let lines: Vec<Value> = text
            .lines()
            .map(|line| serde_json::from_str(line).expect("a JSON line"))
            .collect();
        assert_eq!(lines.len(), 1, "{text}");
        assert_eq!(lines[0]["method"], json!("click"));

        let full_run = run(json!("full"));
        let artifacts = full_run.path().join("artifacts");
        assert!(names(&artifacts)
            .iter()
            .all(|name| !name.ends_with(".jsonl")));
        let sessions = artifacts.join(SESSIONS_DIR);
        let ids = names(&sessions);
        assert_eq!(ids.len(), 1, "{ids:?}");
        let session_dir = sessions.join(&ids[0]);
        let manifest: Value = serde_json::from_str(
            &fs::read_to_string(session_dir.join("manifest.json")).expect("manifest"),
        )
        .expect("manifest JSON");
        let mut members: Vec<&str> = manifest
            .as_object()
            .expect("an object")
            .keys()
            .map(String::as_str)
            .collect();
        members.sort_unstable();
        assert_eq!(
            members,
            [
                "artifacts",
                "created_at",
                "cursor_overlay",
                "ended_at",
                "id",
                "trace"
            ]
        );
        assert_eq!(manifest["trace"], json!("full"));
        assert_eq!(manifest["id"], json!(ids[0]));
        assert!(
            manifest["ended_at"].is_string(),
            "close sets ended_at: {manifest}"
        );
        assert_eq!(
            manifest["artifacts"],
            json!(["turn-00001/action.json", "turn-00001/frame.png"])
        );
        let action: Value = serde_json::from_str(
            &fs::read_to_string(session_dir.join("turn-00001/action.json")).expect("action.json"),
        )
        .expect("action JSON");
        assert_eq!(action["method"], json!("click"));
        assert!(session_dir.join("turn-00001/frame.png").exists());
    }

    #[test]
    fn trace_off_writes_nothing() {
        let off = run(json!(false));
        let listed = names(&off.path().join("artifacts"));
        assert!(
            listed
                .iter()
                .all(|name| !name.ends_with(".jsonl") && name != SESSIONS_DIR),
            "{listed:?}"
        );
    }
}
