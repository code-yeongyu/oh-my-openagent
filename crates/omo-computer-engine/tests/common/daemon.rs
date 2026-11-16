//! A `--serve` daemon under test: spawned with its generation capability on the inherited stdin
//! (first line, 64 hex digits; never argv, env or a file), and clients that dial its socket,
//! send the raw 32-byte preamble, then NDJSON requests that each carry the capability.

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::peer::{engine, runtime_dir};

pub const ONE_WINDOW: &str = r#"{"windows":[{"id":"101","title":"Notes","app":"Notes","pid":4242,"x":0,"y":0,"width":800,"height":600,"focused":true,"elevated":null}]}"#;

pub struct Daemon {
    pub child: Child,
    pub dir: tempfile::TempDir,
    pub capability: [u8; 32],
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

impl Daemon {
    pub fn start(extra_env: &[(&str, &str)]) -> Self {
        Self::start_with(ONE_WINDOW, extra_env)
    }

    pub fn start_with(scenario_json: &str, extra_env: &[(&str, &str)]) -> Self {
        Self::start_with_args(scenario_json, extra_env, &[])
    }

    /// `--serve` with `extra_args` after its endpoint and lock (row 29b: `--start-stopped`).
    pub fn start_with_args(scenario_json: &str, extra_env: &[(&str, &str)], extra_args: &[&str]) -> Self {
        let dir = runtime_dir();
        let capability: [u8; 32] = std::array::from_fn(|i| u8::try_from(i * 7 % 251).expect("byte"));
        let scenario = dir.path().join("scenario.json");
        std::fs::write(&scenario, scenario_json).expect("scenario");
        let mut command = Command::new(engine());
        for (name, _) in std::env::vars().filter(|(name, _)| name.starts_with("OMO_COMPUTER_")) {
            command.env_remove(name);
        }
        command
            .args(["--enable-daemon", "--serve", "--endpoint"])
            .arg(dir.path().join("engine.sock"))
            .arg("--lock")
            .arg(dir.path().join("engine.lock"))
            .args(extra_args)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(std::fs::File::create(dir.path().join("daemon.stderr")).expect("the stderr file"))
            .env("OMO_COMPUTER_BACKEND", "fake")
            .env("OMO_COMPUTER_FAKE_SCENARIO", &scenario)
            .env("OMO_COMPUTER_FAKE_STOP_PATH", "live")
            .env("OMO_COMPUTER_RUNTIME_DIR", dir.path());
        for (name, value) in extra_env {
            command.env(name, value);
        }
        let mut child = command.spawn().expect("the daemon spawns");
        writeln!(child.stdin.as_mut().expect("stdin"), "{}", hex(&capability)).expect("capability line");
        let daemon = Self { child, dir, capability };
        daemon.wait_for_socket();
        daemon
    }

    /// What the daemon wrote to stderr so far (its audit lines for refused own methods).
    pub fn stderr(&self) -> String {
        std::fs::read_to_string(self.dir.path().join("daemon.stderr")).unwrap_or_default()
    }

    pub fn socket(&self) -> PathBuf {
        self.dir.path().join("engine.sock")
    }

    /// Waits for the daemon to LISTEN: the socket file appears at bind, a moment before listen,
    /// so only an accepted connect proves readiness. The probe sends nothing and is closed.
    fn wait_for_socket(&self) {
        let deadline = Instant::now() + Duration::from_secs(10);
        while UnixStream::connect(self.socket()).is_err() {
            assert!(Instant::now() < deadline, "the daemon never listened");
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    pub fn connect(&self, preamble: &[u8]) -> Client {
        Client::dial(&self.socket(), preamble, self.capability)
    }
}

impl Drop for Daemon {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

pub struct Client {
    stream: UnixStream,
    reader: BufReader<UnixStream>,
    pub capability: [u8; 32],
}

impl Client {
    pub fn dial(socket: &Path, preamble: &[u8], capability: [u8; 32]) -> Self {
        let mut stream = UnixStream::connect(socket).expect("dial");
        stream.set_read_timeout(Some(Duration::from_secs(5))).expect("timeout");
        stream.write_all(preamble).expect("preamble");
        let reader = BufReader::new(stream.try_clone().expect("clone"));
        Self { stream, reader, capability }
    }

    /// Sends one request carrying `capability` (the bound one unless overridden).
    pub fn send_with(&mut self, id: i64, method: &str, params: &Value, capability: Option<&str>) {
        let cap = capability.map_or_else(|| hex(&self.capability), str::to_owned);
        let line = json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params, "capability": cap});
        let _ = writeln!(self.stream, "{line}");
    }

    pub fn call(&mut self, id: i64, method: &str, params: &Value) -> Option<Value> {
        self.send_with(id, method, params, None);
        self.read_reply(id)
    }

    /// The next message with `id`, skipping notifications; `None` once the daemon closed us.
    pub fn read_reply(&mut self, id: i64) -> Option<Value> {
        loop {
            let message = self.next_message()?;
            if message.get("id") == Some(&json!(id)) {
                return Some(message);
            }
        }
    }

    pub fn next_message(&mut self) -> Option<Value> {
        let mut line = String::new();
        match self.reader.read_line(&mut line) {
            Ok(0) | Err(_) => None,
            Ok(_) => serde_json::from_str(&line).ok(),
        }
    }

    /// True when the daemon closed (or reset) the connection without sending a single byte.
    pub fn closed_silently(&mut self) -> bool {
        let mut line = String::new();
        match self.reader.read_line(&mut line) {
            Ok(0) | Err(_) => line.is_empty(),
            Ok(_) => false,
        }
    }
}
