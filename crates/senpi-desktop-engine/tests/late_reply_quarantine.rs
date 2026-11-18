//! G15: an input reply that comes back across a stop is quarantined. The
//! stop is read after the click on the same connection, so the click was
//! stamped with the older stop generation whatever the backend was doing.

mod common;

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc;
use std::thread;

use common::scenario::{Scenario, CHORD};
use common::{error_code, BINARY, HANG_GUARD};
use serde_json::{json, Value};

const WINDOW: &str = "101";
const QUARANTINED: &str = "audit: quarantined a late click reply";

struct Engine {
    child: Child,
    stdin: Option<ChildStdin>,
    stdout: mpsc::Receiver<Value>,
    stderr: mpsc::Receiver<String>,
}

fn lines<T: Send + 'static>(
    source: impl std::io::Read + Send + 'static,
    parse: fn(String) -> T,
) -> mpsc::Receiver<T> {
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        for line in BufReader::new(source).lines() {
            let line = line.expect("engine output is UTF-8");
            if sender.send(parse(line)).is_err() {
                return;
            }
        }
    });
    receiver
}

impl Engine {
    fn spawn(scenario: &Scenario) -> Self {
        let (name, value) = scenario.backend();
        let mut child = Command::new(BINARY)
            .arg("--stdio")
            .env_remove("SENPI_DESKTOP_OPERATION_TIMEOUT_MS")
            .env_remove("SENPI_DESKTOP_CLOSE_TIMEOUT_MS")
            .env(name, value)
            .env("SENPI_DESKTOP_FAKE_CLOCK", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("engine spawns");
        let stdout = lines(child.stdout.take().expect("stdout is piped"), |line| {
            serde_json::from_str(&line).expect("every output line is JSON")
        });
        let stderr = lines(child.stderr.take().expect("stderr is piped"), |line| line);
        let stdin = child.stdin.take();
        Self {
            child,
            stdin,
            stdout,
            stderr,
        }
    }

    fn send_all(&mut self, messages: &[Value]) {
        let batch: String = messages.iter().map(|message| format!("{message}\n")).collect();
        let stdin = self.stdin.as_mut().expect("stdin is open");
        stdin.write_all(batch.as_bytes()).expect("engine reads stdin");
        stdin.flush().expect("stdin flushes");
    }

    fn until_reply(&self, id: i64) -> Vec<Value> {
        let mut seen = Vec::new();
        loop {
            let message = self
                .stdout
                .recv_timeout(HANG_GUARD)
                .expect("engine answers within the hang guard");
            let done = message["id"] == json!(id);
            seen.push(message);
            if done {
                return seen;
            }
        }
    }

    fn call(&mut self, id: i64, method: &str, params: Value) -> Value {
        self.send_all(&[request(id, method, params)]);
        self.until_reply(id).pop().expect("until_reply ends at the reply")
    }

    fn live_session(&mut self) {
        let opened = self.call(
            1,
            "session.open",
            json!({"allowHostRelayOnlyStop": true, "reportMode": "object"}),
        );
        assert!(opened["result"]["resumeToken"].is_string(), "{opened}");
        let started = self.call(2, "stopPath.start", json!({"chord": CHORD}));
        assert_eq!(started["result"]["hostRelayLive"], json!(true), "{started}");
        self.call(3, "stopPath.heartbeat", json!({}));
        let captured = self.call(4, "capture", json!({"target": WINDOW}));
        assert!(captured["result"]["frameId"].is_string(), "{captured}");
    }

    fn finish(mut self) -> Vec<String> {
        drop(self.stdin.take());
        let mut rest = Vec::new();
        loop {
            match self.stderr.recv_timeout(HANG_GUARD) {
                Ok(line) => rest.push(line),
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
                Err(mpsc::RecvTimeoutError::Timeout) => panic!("engine did not exit at stdin EOF"),
            }
        }
        self.child.wait().expect("engine exits");
        rest
    }
}

fn request(id: i64, method: &str, params: Value) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params})
}

fn click(id: i64) -> Value {
    request(id, "click", json!({"target": WINDOW, "x": 10.0, "y": 10.0}))
}

fn delayed_click() -> Scenario {
    Scenario::two_displays_with(&json!({"delay_ms": {"click": 2000}}))
}

#[test]
fn a_click_reply_that_arrives_after_a_stop_is_quarantined_as_unknown() {
    // Given: a live object-mode session whose backend takes 2 s per click
    let scenario = delayed_click();
    let mut engine = Engine::spawn(&scenario);
    engine.live_session();
    // When: the stop is read right after the click, before its reply
    engine.send_all(&[
        click(10),
        request(11, "stopPath.stop", json!({"source": "api"})),
    ]);
    let seen = engine.until_reply(10);
    // Then: the stop answered first, and the click resolves unknown/unknown
    let stopped = seen
        .iter()
        .find(|message| message["id"] == json!(11))
        .unwrap_or_else(|| panic!("the stop replied before the click: {seen:?}"));
    assert_eq!(stopped["result"]["suspended"], json!(true), "{stopped}");
    let late = seen.last().expect("until_reply ends at the reply");
    assert_eq!(error_code(late), &json!("Suspended"), "{late}");
    assert_eq!(
        late["error"]["data"]["disposition"],
        json!({"delivery": "unknown", "retry": "unknown"}),
        "{late}"
    );
    let audit = engine.finish();
    assert!(
        audit.iter().any(|line| line.contains(QUARANTINED)),
        "no quarantine line in {audit:?}"
    );
}

#[test]
fn a_click_reply_that_arrives_before_the_stop_keeps_its_disposition() {
    // Given
    let scenario = delayed_click();
    let mut engine = Engine::spawn(&scenario);
    engine.live_session();
    // When: the click is answered, then the stop lands
    let clicked = engine.call(10, "click", json!({"target": WINDOW, "x": 10.0, "y": 10.0}));
    let stopped = engine.call(11, "stopPath.stop", json!({"source": "api"}));
    // Then: the click's own report stands and nothing was quarantined
    assert!(clicked.get("error").is_none(), "{clicked}");
    assert_eq!(
        clicked["result"]["disposition"]["delivery"],
        json!("delivered_unverified"),
        "{clicked}"
    );
    assert_eq!(stopped["result"]["suspended"], json!(true), "{stopped}");
    let audit = engine.finish();
    assert!(
        !audit.iter().any(|line| line.contains("quarantined")),
        "a reply before the stop was quarantined: {audit:?}"
    );
}
