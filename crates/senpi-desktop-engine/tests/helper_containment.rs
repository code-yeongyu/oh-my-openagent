//! G16: every private helper the macOS engine spawns ends within 2 s of a
//! `kill -9` of the engine. A stand-in plays the engine: it starts the helper
//! the way the engine does, says its pid once it runs, and is killed. The
//! canary's `osascript` is covered in the macOS backend's unit tests.
#![cfg(target_os = "macos")]

#[allow(dead_code, reason = "these tests read the ready reply and send no command")]
#[path = "../../senpi-desktop-backend-macos/src/overlay/wire.rs"]
mod overlay_wire;

#[allow(dead_code, reason = "these tests use the encoder, not the decoder")]
#[path = "../../senpi-desktop-backend-macos/src/release_helper/wire.rs"]
mod release_wire;

use std::io::{BufRead, BufReader, Read, Write};
use std::os::fd::OwnedFd;
use std::os::unix::net::UnixStream;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use release_wire::{Record, READY, TOKEN_LEN, VERSION};

const BINARY: &str = env!("CARGO_BIN_EXE_senpi-desktop-engine");
const KIND_ENV: &str = "SENPI_HELPER_CONTAINMENT_TEST_KIND";
const KEYMAP_STALL_ENV: &str = "SENPI_DESKTOP_KEYMAP_HELPER_TEST_STALL";
const RECORD_ENV: &str = "SENPI_DESKTOP_RELEASE_HELPER_RECORD";
const USER_HOLDS_ENV: &str = "SENPI_DESKTOP_RELEASE_HELPER_USER_HOLDS";
const TOKEN: [u8; TOKEN_LEN] = [0x5a; TOKEN_LEN];
const HANG_GUARD: Duration = Duration::from_secs(20);
const CONTAINED_WITHIN: Duration = Duration::from_secs(2);

/// Starts the helper `kind` names as the engine does and returns it once it
/// runs, with whatever keeps its stdin open, and whether it reached its
/// steady state (`false` only for an overlay without a GUI session).
fn start_helper(kind: &str, scratch: &std::path::Path) -> (Child, Option<UnixStream>, bool) {
    match kind {
        "overlay" => {
            let mut child = Command::new(BINARY)
                .arg("--cursor-overlay")
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::inherit())
                .spawn()
                .expect("the overlay starts");
            let mut output = child.stdout.take().expect("stdout is piped");
            let ready = overlay_wire::read::<overlay_wire::Reply>(&mut output).is_ok_and(|reply| reply.token == 0);
            (child, None, ready)
        }
        "keymap" => {
            let mut child = Command::new(BINARY)
                .arg("--keymap-helper")
                .arg(scratch.join("layout"))
                .env(KEYMAP_STALL_ENV, "1")
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::inherit())
                .spawn()
                .expect("the keymap helper starts");
            let output = BufReader::new(child.stdout.take().expect("stdout is piped"));
            let stalled = output.lines().map_while(Result::ok).any(|line| line == "stalled");
            assert!(stalled, "the keymap helper never reached its stall");
            (child, None, true)
        }
        "release" => {
            let (mut stream, theirs) = UnixStream::pair().expect("socket pair");
            let token: String = TOKEN.iter().map(|byte| format!("{byte:02x}")).collect();
            let child = Command::new(BINARY)
                .args(["--release-helper", "--parent", &std::process::id().to_string(), "--token", &token])
                .stdin(Stdio::from(OwnedFd::from(theirs)))
                .stdout(Stdio::null())
                .stderr(Stdio::inherit())
                .env(RECORD_ENV, scratch.join("releases"))
                .env(USER_HOLDS_ENV, "key:60")
                .spawn()
                .expect("the release helper starts");
            let mut bytes = Vec::new();
            for record in [Record::Hello { version: VERSION, token: TOKEN }, Record::Observe] {
                record.encode(&mut bytes);
            }
            stream.write_all(&bytes).expect("the helper reads its stream");
            stream.set_read_timeout(Some(HANG_GUARD)).expect("timeout");
            let mut answer = [0u8];
            stream.read_exact(&mut answer).expect("the helper follows the user");
            assert_eq!(answer[0], READY);
            (child, Some(stream), true)
        }
        other => panic!("unknown helper kind {other}"),
    }
}

/// Plays the engine for the tests below: starts the helper `KIND_ENV` names,
/// says its pid, then waits to be killed.
#[test]
#[ignore = "the engine stand-in of the containment tests, which start it"]
fn helper_engine_stand_in() {
    let kind = std::env::var(KIND_ENV).expect("started by a containment test");
    let scratch = tempfile::tempdir().expect("temp dir");
    let (mut child, _stdin, ready) = start_helper(&kind, scratch.path());
    println!("HELPER {} {}", child.id(), if ready { "ready" } else { "exited" });
    std::io::stdout().flush().expect("stdout");
    let mut never = Vec::new();
    std::io::stdin().read_to_end(&mut never).expect("killed before stdin ends");
    child.wait().expect("the helper exits");
}

/// Kills a stand-in engine running helper `kind` with SIGKILL and asserts the
/// helper is gone within 2 s.
fn assert_contained(kind: &str) {
    // Given: an engine stand-in whose helper runs
    let mut engine = Command::new(std::env::current_exe().expect("test binary"))
        .args(["--ignored", "--exact", "helper_engine_stand_in", "--nocapture", "--test-threads=1"])
        .env(KIND_ENV, kind)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("the engine stand-in starts");
    let stdout = BufReader::new(engine.stdout.take().expect("stdout is piped"));
    let (found, started) = mpsc::channel();
    thread::spawn(move || {
        let helper = stdout.lines().find_map(|line| {
            let line = line.ok()?;
            let (_, rest) = line.rsplit_once("HELPER ")?;
            let (pid, state) = rest.trim().split_once(' ')?;
            Some((pid.parse::<libc::pid_t>().ok()?, state.to_owned()))
        });
        found.send(helper).expect("the test waits");
    });
    let Ok(Some((helper, state))) = started.recv_timeout(HANG_GUARD) else {
        engine.kill().expect("the stand-in is stopped");
        engine.wait().expect("reaped");
        panic!("the stand-in never started the {kind} helper");
    };
    if state != "ready" {
        eprintln!("note: the {kind} helper exited before its steady state (no GUI session)");
    }
    // When: the engine is killed with SIGKILL
    engine.kill().expect("the engine is killed");
    engine.wait().expect("reaped");
    // Then
    assert!(
        gone_within(helper, CONTAINED_WITHIN),
        "the {kind} helper (pid {helper}) outlived its engine by {CONTAINED_WITHIN:?}"
    );
}

/// Whether `pid` stops existing before `limit` passes; the limit is the
/// behavior under test.
fn gone_within(pid: libc::pid_t, limit: Duration) -> bool {
    let deadline = Instant::now() + limit;
    loop {
        // SAFETY: [FFI] signal 0 only checks that the pid exists.
        if unsafe { libc::kill(pid, 0) } != 0 {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn a_killed_engine_takes_its_cursor_overlay_with_it() {
    assert_contained("overlay");
}

#[test]
fn a_killed_engine_takes_its_keymap_helper_with_it() {
    assert_contained("keymap");
}

#[test]
fn a_killed_engine_leaves_no_release_helper_past_its_deadline() {
    assert_contained("release");
}
