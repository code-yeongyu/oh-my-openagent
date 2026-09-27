#![cfg(unix)]

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use serde_json::{json, Value};

const HANG_GUARD: Duration = Duration::from_secs(30);
const BINARY: &str = env!("CARGO_BIN_EXE_senpi-desktop-engine");
const TWO_DISPLAYS: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../senpi-desktop-backend-fake/fixtures/two-displays-one-window.json"
);

fn exchange(socket: &Path, request: &Value) -> Value {
    let mut stream = UnixStream::connect(socket).expect("client connects");
    writeln!(stream, "{request}").expect("request is written");
    stream
        .set_read_timeout(Some(HANG_GUARD))
        .expect("read timeout is set");
    let mut line = String::new();
    BufReader::new(&stream)
        .read_line(&mut line)
        .expect("reply arrives within the hang guard");
    serde_json::from_str(&line).expect("reply is JSON")
}

#[test]
fn serve_shares_one_session_across_successive_clients_and_exits_when_idle() {
    // Given
    let dir = std::env::temp_dir().join(format!("senpi-desktop-serve-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("temp dir");
    let socket = dir.join("engine.sock");
    let mut child = Command::new(BINARY)
        .args([
            "--serve",
            socket.to_str().expect("utf-8 path"),
            "--idle-ms",
            "300",
        ])
        .env("SENPI_DESKTOP_BACKEND", format!("fake:{TWO_DISPLAYS}"))
        .stderr(Stdio::piped())
        .spawn()
        .expect("engine spawns");
    let mut stderr = BufReader::new(child.stderr.take().expect("stderr is piped"));
    let mut ready = String::new();
    stderr.read_line(&mut ready).expect("readiness line");
    assert!(ready.contains("serving on"), "{ready}");
    // When: client 1 opens the session, client 2 uses it.
    let opened = exchange(
        &socket,
        &json!({"jsonrpc": "2.0", "id": 1, "method": "session.open", "params": {}}),
    );
    let displays = exchange(
        &socket,
        &json!({"jsonrpc": "2.0", "id": 2, "method": "displays", "params": {}}),
    );
    // Then
    assert_eq!(opened["result"]["capabilities"]["backend"], json!("fake"));
    assert_eq!(displays["result"].as_array().map(Vec::len), Some(2), "{displays}");
    let (sender, exited) = mpsc::channel();
    thread::spawn(move || sender.send(child.wait().expect("engine exits")));
    let status = exited
        .recv_timeout(HANG_GUARD)
        .expect("idle engine exits within the hang guard");
    assert!(status.success());
    assert!(!socket.exists(), "the socket file is removed at exit");
    std::fs::remove_dir_all(&dir).expect("temp dir removed");
}
