use super::{coordination, Overlay};
use senpi_desktop_core::error::ErrorCode;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

const TEST: &str = "overlay::capture_budget_tests::foreign_helper_past_deadline_returns_a_bounded_capture_error";

struct Holder(Child);

impl Drop for Holder {
    fn drop(&mut self) {
        match self.0.kill() {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::InvalidInput => {}
            Err(error) => panic!("lock holder termination failed: {error}"),
        }
        self.0.wait().unwrap();
    }
}

#[test]
fn foreign_helper_past_deadline_returns_a_bounded_capture_error() {
    if let Some(path) = std::env::var_os("SENPI_CURSOR_HELD_LOCK") {
        let _visible = coordination::visible(coordination::open(path.as_ref()).unwrap()).unwrap().unwrap();
        println!("\nHELD_LOCK ready");
        let mut command = String::new();
        std::io::stdin().read_line(&mut command).unwrap();
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("overlay.lock");
    let child = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", TEST, "--nocapture"])
        .env("SENPI_CURSOR_HELD_LOCK", &path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn().unwrap();
    let mut holder = Holder(child);
    let output = holder.0.stdout.take().unwrap();
    let (send, ready) = mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(output).lines() {
            if line.unwrap() == "HELD_LOCK ready" {
                send.send(()).unwrap();
                return;
            }
        }
    });
    ready.recv_timeout(Duration::from_secs(30)).unwrap();
    let started = Instant::now();
    let mut ran = false;
    let result = Overlay::default().capture(
        &path,
        || Ok(Vec::new()),
        std::thread::sleep,
        |_| {
            ran = true;
            Ok(())
        },
    );
    let elapsed = started.elapsed();
    assert_eq!(result.unwrap_err().code, ErrorCode::CaptureFailed);
    assert!(!ran);
    // Time is the behavior under test; no guessed sleep releases the holder.
    assert!(elapsed >= Duration::from_millis(1500));
    assert!(
        elapsed < coordination::CAPTURE_WAIT + Duration::from_secs(5),
        "capture exceeded its bounded wait: {elapsed:?}"
    );
}
