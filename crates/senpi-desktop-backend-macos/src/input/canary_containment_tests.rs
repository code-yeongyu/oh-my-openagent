//! G16: a canary dialog does not outlive the engine that started it.

use std::io::{BufRead, BufReader, Read};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use super::contained_osascript;

const STAND_IN: &str = "input::canary::containment_tests::canary_engine_stand_in";
const HANG_GUARD: Duration = Duration::from_secs(20);
const CONTAINED_WITHIN: Duration = Duration::from_secs(2);

/// Plays the engine: starts a contained `osascript` that would run 30 s,
/// says its process group once `osascript` runs, then waits to be killed.
#[test]
#[ignore = "the engine stand-in of a_killed_engine_takes_its_canary_dialog_with_it, which starts it"]
fn canary_engine_stand_in() {
    let mut child = contained_osascript("log \"running\"\ndelay 30")
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .expect("the contained osascript starts");
    let stderr = BufReader::new(child.stderr.take().expect("stderr is piped"));
    let running = stderr.lines().map_while(Result::ok).any(|line| line.contains("running"));
    assert!(running, "osascript never ran its script");
    println!("GROUP {}", child.id());
    let mut never = Vec::new();
    std::io::stdin().read_to_end(&mut never).expect("killed before stdin ends");
    child.wait().expect("the contained osascript exits");
}

#[test]
fn a_killed_engine_takes_its_canary_dialog_with_it() {
    // Given: an engine stand-in whose contained osascript is running
    let mut engine = Command::new(std::env::current_exe().expect("test binary"))
        .args(["--ignored", "--exact", STAND_IN, "--nocapture", "--test-threads=1"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("the engine stand-in starts");
    let stdout = BufReader::new(engine.stdout.take().expect("stdout is piped"));
    let (found, started) = mpsc::channel();
    thread::spawn(move || {
        let group = stdout
            .lines()
            .find_map(|line| line.ok()?.rsplit_once("GROUP ")?.1.trim().parse::<libc::pid_t>().ok());
        found.send(group).expect("the test waits");
    });
    let Ok(Some(group)) = started.recv_timeout(HANG_GUARD) else {
        engine.kill().expect("the stand-in is stopped");
        engine.wait().expect("reaped");
        panic!("the stand-in never started a contained osascript");
    };
    // When: the engine is killed with SIGKILL
    engine.kill().expect("the engine is killed");
    engine.wait().expect("reaped");
    // Then: osascript, its shell and the watcher are gone within 2 s
    assert!(
        group_gone_within(group, CONTAINED_WITHIN),
        "process group {group} outlived its engine by {CONTAINED_WITHIN:?}"
    );
}

/// Whether no process of `group` remains before `limit` passes; the limit is
/// the behavior under test.
fn group_gone_within(group: libc::pid_t, limit: Duration) -> bool {
    let deadline = Instant::now() + limit;
    loop {
        // SAFETY: [FFI] signal 0 only checks for members of the group.
        if unsafe { libc::killpg(group, 0) } != 0 {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        thread::sleep(Duration::from_millis(20));
    }
}
