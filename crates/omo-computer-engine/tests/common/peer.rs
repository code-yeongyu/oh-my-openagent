//! One engine process driven over its standard streams: one JSON line in per request, replies
//! queued by a reader thread, a bounded wait per message and a bounded close that kills an
//! engine that does not exit.

use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::Value;

pub const MESSAGE_TIMEOUT: Duration = Duration::from_secs(10);
const EXIT_TIMEOUT: Duration = Duration::from_secs(5);

pub fn engine() -> &'static str {
    env!("CARGO_BIN_EXE_omo-computer-engine")
}

pub struct Peer {
    pub child: Child,
    stdin: Option<ChildStdin>,
    replies: Receiver<Value>,
}

impl Peer {
    pub fn spawn(args: &[&str], env: &[(String, String)], cwd: &Path) -> Self {
        let mut command = Command::new(engine());
        command
            .args(args)
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());
        for (name, _) in std::env::vars().filter(|(name, _)| name.starts_with("OMO_COMPUTER_")) {
            command.env_remove(name);
        }
        command.envs(env.iter().map(|(name, value)| (name, value)));
        let mut child = command.spawn().expect("the engine spawns");
        let stdout = child.stdout.take().expect("stdout is piped");
        let (sender, replies) = mpsc::channel();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { return };
                if line.trim().is_empty() {
                    continue;
                }
                let message = serde_json::from_str(&line).unwrap_or(Value::String(line));
                if sender.send(message).is_err() {
                    return;
                }
            }
        });
        let stdin = child.stdin.take();
        Self {
            child,
            stdin,
            replies,
        }
    }

    pub fn send(&mut self, message: &Value) {
        if let Some(stdin) = self.stdin.as_mut() {
            let sent = writeln!(stdin, "{message}").and_then(|()| stdin.flush());
            if sent.is_err() {
                self.stdin = None;
            }
        }
    }

    pub fn next(&self) -> Option<Value> {
        self.next_within(MESSAGE_TIMEOUT)
    }

    pub fn next_within(&self, wait: Duration) -> Option<Value> {
        self.replies.recv_timeout(wait).ok()
    }

    /// Closes stdin, waits up to five seconds for the exit, kills the engine past that, and
    /// returns every message it wrote that no step read.
    pub fn close(mut self) -> Vec<Value> {
        drop(self.stdin.take());
        let deadline = Instant::now() + EXIT_TIMEOUT;
        while self.child.try_wait().ok().flatten().is_none() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(20));
        }
        if self.child.try_wait().ok().flatten().is_none() {
            let _ = self.child.kill();
        }
        let _ = self.child.wait();
        let mut leftovers = Vec::new();
        loop {
            match self.replies.recv_timeout(Duration::from_millis(200)) {
                Ok(message) => leftovers.push(message),
                Err(RecvTimeoutError::Timeout | RecvTimeoutError::Disconnected) => {
                    return leftovers
                }
            }
        }
    }
}
