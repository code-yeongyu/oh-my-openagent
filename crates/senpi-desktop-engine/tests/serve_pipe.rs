#![cfg(windows)]
//! T25-8: `--serve` on a Windows named pipe keeps one client at a time until a
//! client SID check exists (#12229 B3): a second concurrent client is
//! disconnected without a reply and the first one keeps being served.

use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

const BINARY: &str = env!("CARGO_BIN_EXE_senpi-desktop-engine");
const TWO_DISPLAYS: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../senpi-desktop-backend-fake/fixtures/two-displays-one-window.json"
);
const ERROR_PIPE_BUSY: i32 = 231;

/// Opens the pipe, retrying while every instance is busy.
fn open(endpoint: &str) -> std::fs::File {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        match std::fs::OpenOptions::new().read(true).write(true).open(endpoint) {
            Ok(file) => return file,
            Err(error) if error.raw_os_error() == Some(ERROR_PIPE_BUSY) && Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(20));
            }
            Err(error) => panic!("{endpoint}: {error}"),
        }
    }
}

fn request(id: i64, method: &str) -> String {
    format!("{}\n", json!({"jsonrpc": "2.0", "id": id, "method": method, "params": {}}))
}

/// The next reply line of `reader`, skipping notifications.
fn reply(reader: &mut BufReader<std::fs::File>) -> Value {
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).expect("a reply line");
        let value: Value = serde_json::from_str(&line).unwrap_or_else(|error| panic!("{error}: {line:?}"));
        if value.get("id").is_some() {
            return value;
        }
    }
}

#[test]
fn t25_8_a_second_concurrent_pipe_client_is_refused_and_the_first_continues() {
    // Given: a daemon serving one client.
    let endpoint = format!(r"\\.\pipe\senpi-t25-8-{}", std::process::id());
    let mut child = Command::new(BINARY)
        .args(["--enable-daemon", "--serve", &endpoint, "--idle-ms", "1000"])
        .env("SENPI_DESKTOP_BACKEND", format!("fake:{TWO_DISPLAYS}"))
        .env("SENPI_DESKTOP_FAKE_STOP_PATH", "live")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .expect("engine spawns");
    let mut stderr = BufReader::new(child.stderr.take().expect("stderr"));
    let mut ready = String::new();
    stderr.read_line(&mut ready).expect("readiness line");
    assert!(ready.contains("serving on"), "{ready}");
    std::thread::spawn(move || std::io::copy(&mut stderr, &mut std::io::sink()));
    let first = open(&endpoint);
    let mut first_writer = first.try_clone().expect("clone");
    let mut first_reader = BufReader::new(first);
    first_writer.write_all(request(1, "engine.hello").as_bytes()).expect("hello written");
    assert_eq!(reply(&mut first_reader)["id"], json!(1));
    // When: a second client connects while the first is still connected.
    let mut second = open(&endpoint);
    let _ = second.write_all(request(1, "engine.hello").as_bytes());
    let mut received = Vec::new();
    let _ = second.read_to_end(&mut received);
    // Then: it is disconnected without a byte, and the first is still served.
    assert!(received.is_empty(), "{}", String::from_utf8_lossy(&received));
    first_writer.write_all(request(2, "displays").as_bytes()).expect("request written");
    let displays = reply(&mut first_reader);
    assert_eq!(displays["result"].as_array().map(Vec::len), Some(2), "{displays}");
    drop((first_writer, first_reader, second));
    assert!(child.wait().expect("engine exits").success());
}
