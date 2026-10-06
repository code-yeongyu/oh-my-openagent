//! Drives the built engine binary over stdio. Every wait is bounded by
//! `HANG_GUARD`, a hang guard only: no assertion depends on latency.
#![allow(
    dead_code,
    reason = "every integration-test crate compiles this module and uses a different subset of it"
)]

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, ExitStatus, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use serde_json::{json, Value};

pub mod scenario;

pub const HANG_GUARD: Duration = Duration::from_secs(30);
pub const BINARY: &str = env!("CARGO_BIN_EXE_senpi-desktop-engine");
pub const TWO_DISPLAYS: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../senpi-desktop-backend-fake/fixtures/two-displays-one-window.json"
);
pub const DELAYED_CAPTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/delay-capture-5000ms.json"
);

const ENGINE_ENV: [&str; 4] = [
    "SENPI_DESKTOP_BACKEND",
    "SENPI_DESKTOP_FAKE_CLOCK",
    "SENPI_DESKTOP_OPERATION_TIMEOUT_MS",
    "SENPI_DESKTOP_CLOSE_TIMEOUT_MS",
];

pub fn fake_backend(scenario: &str) -> (&'static str, String) {
    ("SENPI_DESKTOP_BACKEND", format!("fake:{scenario}"))
}

pub struct Engine {
    child: Child,
    stdin: Option<ChildStdin>,
    lines: mpsc::Receiver<Value>,
    /// Id of the next [`Engine::invoke`]; far above the explicit ids tests pick.
    next_id: i64,
}

impl Engine {
    /// Spawns `--stdio` with exactly `env` among the engine's variables.
    pub fn spawn(env: &[(&str, String)]) -> Self {
        let mut command = Command::new(BINARY);
        command
            .arg("--stdio")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped());
        for name in ENGINE_ENV {
            command.env_remove(name);
        }
        for (name, value) in env {
            command.env(name, value);
        }
        let mut child = command.spawn().expect("engine spawns");
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
            next_id: 1_000,
        }
    }

    pub fn send(&mut self, message: &Value) {
        self.send_all(std::slice::from_ref(message));
    }

    /// Writes every message in one write, so no test-side scheduling gap can
    /// separate them.
    pub fn send_all(&mut self, messages: &[Value]) {
        let batch: String = messages.iter().map(|message| format!("{message}\n")).collect();
        let stdin = self.stdin.as_mut().expect("stdin is open");
        stdin.write_all(batch.as_bytes()).expect("engine reads stdin");
        stdin.flush().expect("stdin flushes");
    }

    pub fn request(&mut self, id: i64, method: &str, params: Value) {
        self.send(&json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}));
    }

    /// The next output line.
    pub fn next(&self) -> Value {
        self.lines
            .recv_timeout(HANG_GUARD)
            .expect("engine answers within the hang guard")
    }

    /// Sends a request and returns its reply: the next line with an id.
    /// Notifications before it (`audit` of an earlier request, ...) are skipped.
    pub fn call(&mut self, id: i64, method: &str, params: Value) -> Value {
        self.request(id, method, params);
        loop {
            let message = self.next();
            if message.get("id").is_some() {
                assert_eq!(message["id"], json!(id), "reply to {method}: {message}");
                return message;
            }
        }
    }

    /// [`Engine::call`] with the next free id.
    pub fn invoke(&mut self, method: &str, params: Value) -> Value {
        self.next_id += 1;
        self.call(self.next_id, method, params)
    }

    /// Closes stdin and returns every line written before the engine exits.
    pub fn drain(mut self) -> Vec<Value> {
        drop(self.stdin.take());
        let mut rest = Vec::new();
        loop {
            match self.lines.recv_timeout(HANG_GUARD) {
                Ok(message) => rest.push(message),
                Err(mpsc::RecvTimeoutError::Disconnected) => return rest,
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    panic!("engine did not exit at stdin EOF within the hang guard")
                }
            }
        }
    }

    /// Closes stdin and returns the exit status.
    pub fn finish(mut self) -> ExitStatus {
        drop(self.stdin.take());
        let (sender, exited) = mpsc::channel();
        thread::spawn(move || sender.send(self.child.wait().expect("engine exits")));
        exited
            .recv_timeout(HANG_GUARD)
            .expect("engine exits at stdin EOF within the hang guard")
    }
}

/// `data.code` of an error reply.
pub fn error_code(reply: &Value) -> &Value {
    &reply["error"]["data"]["code"]
}
