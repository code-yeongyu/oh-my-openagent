//! Replays the v1 consumer corpus (`tests/fixtures/v1-consumers`) against the
//! built engine binary the way today's consumers drive it, over the fake
//! backend:
//!
//! - `stdio`: a v1 host on `--stdio` that opens its session with no options;
//! - `oneshot`: bunshin's `--oneshot` sidecar, one process per request, against
//!   the `--serve` daemon the first request auto-starts with no session flags;
//! - `mcp`: the `--mcp` stdio server over the same kind of daemon.
//!
//! The corpus freezes today's replies before any v2 behavior change: each
//! step's messages must deep-equal the expected ones modulo the declared
//! `variable` JSON pointers (present, any value), in any order within the step,
//! and nothing may be left over after the last step. Later rows replay it
//! unchanged, so a v1 consumer's view of the engine is proven, not assumed.

mod common;

use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc;
use std::thread;

use common::{fake_backend, Engine, BINARY, HANG_GUARD};
use serde::Deserialize;
use serde_json::{json, Value};

const REPO_ROOT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../..");
const CORPUS: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/v1-consumers");
const MIN_CASES: usize = 9;
/// Engine variables a case never inherits from the test's environment.
const UNSET_ENV: [&str; 4] = [
    "SENPI_DESKTOP_BACKEND",
    "SENPI_DESKTOP_FAKE_CLOCK",
    "SENPI_DESKTOP_OPERATION_TIMEOUT_MS",
    "SENPI_DESKTOP_CLOSE_TIMEOUT_MS",
];

#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
enum Transport {
    Stdio,
    Oneshot,
    Mcp,
}

#[derive(Deserialize)]
struct Case {
    transport: Transport,
    scenario: String,
    #[serde(default)]
    env: BTreeMap<String, String>,
    steps: Vec<Step>,
}

#[derive(Deserialize)]
struct Step {
    send: Value,
    expect: Vec<Expected>,
}

#[derive(Deserialize)]
struct Expected {
    message: Value,
    #[serde(default)]
    variable: Vec<String>,
}

/// `message` with every `variable` member nulled; `None` when one is absent.
fn masked(message: &Value, variable: &[String]) -> Option<Value> {
    let mut masked = message.clone();
    for pointer in variable {
        *masked.pointer_mut(pointer)? = Value::Null;
    }
    Some(masked)
}

fn matches(expected: &Expected, actual: &Value) -> bool {
    masked(actual, &expected.variable)
        .is_some_and(|actual| masked(&expected.message, &expected.variable) == Some(actual))
}

/// A process speaking newline-delimited JSON on stdin/stdout (`--mcp`).
struct LineChild {
    child: Child,
    stdin: Option<ChildStdin>,
    lines: mpsc::Receiver<Value>,
}

impl LineChild {
    fn spawn(mut command: Command) -> Self {
        let mut child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .expect("engine spawns");
        let stdout = child.stdout.take().expect("stdout is piped");
        let (sender, lines) = mpsc::channel();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let line = line.expect("engine output is UTF-8");
                let message = serde_json::from_str(&line).expect("every output line is JSON");
                if sender.send(message).is_err() {
                    return;
                }
            }
        });
        let stdin = child.stdin.take();
        Self {
            child,
            stdin,
            lines,
        }
    }

    fn send(&mut self, message: &Value) {
        let stdin = self.stdin.as_mut().expect("stdin is open");
        writeln!(stdin, "{message}").expect("engine reads stdin");
        stdin.flush().expect("stdin flushes");
    }

    fn next(&self) -> Value {
        self.lines
            .recv_timeout(HANG_GUARD)
            .expect("engine answers within the hang guard")
    }

    /// Closes stdin and returns every line written before the process exits.
    fn drain(mut self) -> Vec<Value> {
        drop(self.stdin.take());
        let mut rest = Vec::new();
        loop {
            match self.lines.recv_timeout(HANG_GUARD) {
                Ok(message) => rest.push(message),
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    panic!("engine did not exit at stdin EOF within the hang guard")
                }
            }
        }
        let _ = self.child.wait();
        rest
    }
}

/// The daemon's socket directory; short so the unix socket path fits.
struct DaemonDir(PathBuf);

impl DaemonDir {
    fn new(index: usize) -> Self {
        let dir = std::env::temp_dir().join(format!("senpi-v1c-{}-{index}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        Self(dir)
    }

    fn socket(&self) -> String {
        self.0
            .join("e.sock")
            .to_str()
            .expect("utf-8 path")
            .to_owned()
    }
}

impl Drop for DaemonDir {
    fn drop(&mut self) {
        // A leftover dir in the temp dir is harmless; the next run uses a new name.
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn engine_command(env: &[(String, String)], args: &[&str]) -> Command {
    let mut command = Command::new(BINARY);
    command.args(args);
    for name in UNSET_ENV {
        command.env_remove(name);
    }
    for (name, value) in env {
        command.env(name, value);
    }
    command
}

/// One `--oneshot` process: the request line in, every reply line out.
fn oneshot(env: &[(String, String)], socket: &str, request: &Value) -> Vec<Value> {
    let mut child = engine_command(
        env,
        &[
            "--enable-daemon",
            "--oneshot",
            "--idle-ms",
            "3000",
            "--endpoint",
            socket,
        ],
    )
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .spawn()
    .expect("oneshot spawns");
    writeln!(child.stdin.take().expect("stdin"), "{request}").expect("request written");
    let mut stdout = child.stdout.take().expect("stdout is piped");
    let (sender, read) = mpsc::channel();
    thread::spawn(move || {
        let mut text = String::new();
        let _ = sender.send(stdout.read_to_string(&mut text).map(|_| text));
    });
    let Ok(text) = read.recv_timeout(HANG_GUARD) else {
        let _ = child.kill();
        let _ = child.wait();
        panic!("--oneshot did not answer {request} within the hang guard");
    };
    let status = child.wait().expect("oneshot exits");
    assert!(status.success(), "{status:?}");
    text.expect("oneshot output is UTF-8")
        .lines()
        .map(|line| serde_json::from_str(line).expect("every output line is JSON"))
        .collect()
}

enum Driver {
    Stdio(Engine),
    Oneshot {
        env: Vec<(String, String)>,
        dir: DaemonDir,
    },
    Mcp {
        child: LineChild,
        _dir: DaemonDir,
    },
}

impl Driver {
    fn start(index: usize, transport: Transport, env: Vec<(String, String)>) -> Self {
        match transport {
            Transport::Stdio => {
                let env: Vec<(&str, String)> = env
                    .iter()
                    .map(|(name, value)| (name.as_str(), value.clone()))
                    .collect();
                Self::Stdio(Engine::spawn(&env))
            }
            Transport::Oneshot => Self::Oneshot {
                env,
                dir: DaemonDir::new(index),
            },
            Transport::Mcp => {
                let dir = DaemonDir::new(index);
                let socket = dir.socket();
                let command = engine_command(
                    &env,
                    &[
                        "--enable-daemon",
                        "--mcp",
                        "--idle-ms",
                        "3000",
                        "--endpoint",
                        &socket,
                    ],
                );
                Self::Mcp {
                    child: LineChild::spawn(command),
                    _dir: dir,
                }
            }
        }
    }

    fn exchange(&mut self, message: &Value, expected: usize) -> Vec<Value> {
        match self {
            Self::Stdio(engine) => {
                engine.send(message);
                (0..expected).map(|_| engine.next()).collect()
            }
            Self::Oneshot { env, dir } => oneshot(env, &dir.socket(), message),
            Self::Mcp { child, .. } => {
                child.send(message);
                (0..expected).map(|_| child.next()).collect()
            }
        }
    }

    fn finish(self) -> Vec<Value> {
        match self {
            Self::Stdio(engine) => engine.drain(),
            Self::Oneshot { .. } => Vec::new(),
            Self::Mcp { child, .. } => child.drain(),
        }
    }
}

fn replay(index: usize, name: &str, case: &Case) -> Result<(), String> {
    let scenario = Path::new(REPO_ROOT).join(&case.scenario);
    if !scenario.is_file() {
        return Err(format!("{name}: scenario {} does not exist", case.scenario));
    }
    let (backend, value) = fake_backend(scenario.to_str().expect("repo paths are UTF-8"));
    let mut env = vec![(backend.to_owned(), value)];
    env.extend(
        case.env
            .iter()
            .map(|(key, value)| (key.clone(), value.clone())),
    );
    let mut driver = Driver::start(index, case.transport, env);
    for (index, step) in case.steps.iter().enumerate() {
        let mut actual = driver.exchange(&step.send, step.expect.len());
        for (slot, expected) in step.expect.iter().enumerate() {
            let Some(found) = actual.iter().position(|message| matches(expected, message)) else {
                return Err(format!(
                    "{name}: steps/{index}/expect/{slot}: no message matched {}; got {actual:?}",
                    expected.message
                ));
            };
            actual.swap_remove(found);
        }
        if !actual.is_empty() {
            return Err(format!(
                "{name}: steps/{index}: unexpected messages {actual:?}"
            ));
        }
    }
    let trailing = driver.finish();
    if trailing.is_empty() {
        return Ok(());
    }
    Err(format!("{name}: unexpected trailing messages {trailing:?}"))
}

fn corpus() -> Vec<(String, Case)> {
    let mut paths: Vec<PathBuf> = std::fs::read_dir(CORPUS)
        .unwrap_or_else(|error| panic!("corpus {CORPUS} is readable: {error}"))
        .map(|entry| entry.expect("corpus entry is readable").path())
        .filter(|path| {
            path.extension()
                .is_some_and(|extension| extension == "json")
        })
        .collect();
    paths.sort();
    paths
        .into_iter()
        .map(|path| {
            let name = path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .unwrap_or_default()
                .to_owned();
            let text = std::fs::read_to_string(&path).expect("fixture is readable");
            let case =
                serde_json::from_str(&text).unwrap_or_else(|error| panic!("{name}: {error}"));
            (name, case)
        })
        .collect()
}

/// The daemon transports use a unix socket endpoint, as `serve_oneshot.rs` does.
fn replayable(case: &Case) -> bool {
    cfg!(unix) || case.transport == Transport::Stdio
}

#[test]
fn the_corpus_covers_every_v1_consumer_and_opens_sessions_without_options() {
    // Given
    let corpus = corpus();
    // Then
    assert!(
        corpus.len() >= MIN_CASES,
        "the v1 consumer corpus has {} cases, fewer than {MIN_CASES}",
        corpus.len()
    );
    for transport in [Transport::Stdio, Transport::Oneshot, Transport::Mcp] {
        assert!(
            corpus.iter().any(|(_, case)| case.transport == transport),
            "no {transport:?} case in the v1 consumer corpus"
        );
    }
    for (name, case) in corpus
        .iter()
        .filter(|(_, case)| case.transport == Transport::Stdio)
    {
        let first = &case.steps.first().expect("a case has steps").send;
        assert_eq!(
            (&first["method"], &first["params"]),
            (&json!("session.open"), &json!({})),
            "{name}: a v1 host opens its session first and with no options"
        );
    }
}

#[test]
fn every_v1_consumer_case_replays_against_the_engine_binary() {
    // Given
    let corpus = corpus();
    assert!(!corpus.is_empty(), "the v1 consumer corpus is empty");
    // When
    for (name, _) in corpus.iter().filter(|(_, case)| !replayable(case)) {
        eprintln!("v1 consumer case {name} skipped: its daemon transport needs a unix socket");
    }
    let failures: Vec<String> = corpus
        .iter()
        .enumerate()
        .filter(|(_, (_, case))| replayable(case))
        .filter_map(|(index, (name, case))| replay(index, name, case).err())
        .collect();
    // Then
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
