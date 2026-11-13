//! The input-release helper (#11466) as the real engine binary runs it. It
//! refuses a parent that is not the engine and a stream without its spawn
//! token; when the engine is killed mid-request it releases what is still
//! held, leaving what the user physically holds, even after its session got a
//! hangup and a terminate. Releases go to a record file (the helper's env
//! seam, which the engine strips from every helper it spawns) instead of the
//! desktop.
#![cfg(target_os = "macos")]

#[allow(dead_code, reason = "these tests use the encoder, not the decoder")]
#[path = "../../senpi-desktop-backend-macos/src/release_helper/wire.rs"]
mod wire;

use std::io::{BufRead, BufReader, Read, Write};
use std::os::fd::OwnedFd;
use std::os::unix::net::UnixStream;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use wire::{Input, Record, Route, READY, TOKEN_LEN, VERSION};

const BINARY: &str = env!("CARGO_BIN_EXE_senpi-desktop-engine");
const RECORD_ENV: &str = "SENPI_DESKTOP_RELEASE_HELPER_RECORD";
const USER_HOLDS_ENV: &str = "SENPI_DESKTOP_RELEASE_HELPER_USER_HOLDS";
const STAND_IN_ENV: &str = "SENPI_RELEASE_HELPER_TEST_STAND_IN";
const TOKEN: [u8; TOKEN_LEN] = [0x5a; TOKEN_LEN];
const HANG_GUARD: Duration = Duration::from_secs(20);
const TARGET: i32 = 4242;

fn helper(parent: u32, record: &Path, stdin: OwnedFd) -> Command {
    let token: String = TOKEN.iter().map(|byte| format!("{byte:02x}")).collect();
    let mut command = Command::new(BINARY);
    command
        .args(["--release-helper", "--parent", &parent.to_string(), "--token", &token])
        .stdin(Stdio::from(stdin))
        .stdout(Stdio::null())
        .env(RECORD_ENV, record);
    command
}

fn write(stream: &mut UnixStream, records: &[Record]) {
    let mut bytes = Vec::new();
    for record in records {
        record.encode(&mut bytes);
    }
    stream.write_all(&bytes).expect("the helper reads its stream");
}

fn hello(token: [u8; TOKEN_LEN]) -> Record {
    Record::Hello { version: VERSION, token }
}

fn press(id: u32, route: Route, input: Input, text: Option<&str>) -> Record {
    Record::Press { id, route, input, text: text.map(str::to_owned) }
}

/// Runs the helper as a child of this test with a stream that ends at once.
fn run_to_the_end(parent: u32, records: &[Record], record: &Path) -> std::process::Output {
    let (mut stream, theirs) = UnixStream::pair().expect("socket pair");
    write(&mut stream, records);
    drop(stream);
    helper(parent, record, theirs.into()).output().expect("the helper runs")
}

#[test]
fn a_stream_that_ends_with_presses_open_is_released_latest_first() {
    // Given
    let dir = tempfile::tempdir().expect("temp dir");
    let record = dir.path().join("releases");
    let records = [
        hello(TOKEN),
        press(0, Route::Keyboard(TARGET), Input::Key(56), None),
        press(1, Route::Keyboard(TARGET), Input::Key(0), Some("a")),
        press(2, Route::Keyboard(TARGET), Input::Key(1), None),
        Record::Release { id: 2 },
    ];
    // When
    let output = run_to_the_end(std::process::id(), &records, &record);
    // Then
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    let releases = std::fs::read_to_string(record).expect("releases recorded");
    assert_eq!(releases.lines().collect::<Vec<_>>(), [
        "post 1 keyboard:4242 key:0 text=a flags=0x20000",
        "post 0 keyboard:4242 key:56 flags=0x0",
    ]);
}

#[test]
fn the_helper_refuses_a_parent_that_is_not_the_engine() {
    // Given: pid 1 (launchd) did not start it.
    let dir = tempfile::tempdir().expect("temp dir");
    let record = dir.path().join("releases");
    let records = [hello(TOKEN), press(0, Route::Keyboard(TARGET), Input::Key(56), None)];
    // When
    let output = run_to_the_end(1, &records, &record);
    // Then
    assert!(!output.status.success());
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("refusing to run: started by pid"), "{stderr}");
    assert!(!record.exists(), "a refused helper releases nothing");
}

#[test]
fn the_helper_refuses_a_stream_without_its_spawn_token() {
    // Given
    let dir = tempfile::tempdir().expect("temp dir");
    let record = dir.path().join("releases");
    let records = [hello([0x11; TOKEN_LEN]), press(0, Route::Keyboard(TARGET), Input::Key(56), None)];
    // When
    let output = run_to_the_end(std::process::id(), &records, &record);
    // Then
    assert!(!output.status.success());
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("spawn token"), "{stderr}");
    assert!(!record.exists(), "a refused helper releases nothing");
}

/// Plays the engine for `a_killed_engine_leaves_the_helper_to_release_what_it_held`:
/// starts the helper, streams an input request mid-way, says the helper's pid,
/// then waits to be killed.
#[test]
#[ignore = "the engine stand-in of a_killed_engine_leaves_the_helper_to_release_what_it_held, which starts it"]
fn engine_stand_in() {
    let record = std::env::var_os(STAND_IN_ENV).expect("started by the killed-engine test");
    let (mut stream, theirs) = UnixStream::pair().expect("socket pair");
    let mut child = helper(std::process::id(), Path::new(&record), theirs.into())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("the helper starts");
    write(&mut stream, &[hello(TOKEN), Record::Observe]);
    stream.set_read_timeout(Some(HANG_GUARD)).expect("timeout");
    let mut answer = [0u8];
    stream.read_exact(&mut answer).expect("the helper follows the user");
    assert_eq!(answer[0], READY);
    write(&mut stream, &[
        press(0, Route::Keyboard(TARGET), Input::Key(56), None),
        press(1, Route::Keyboard(TARGET), Input::Key(0), Some("a")),
        press(2, Route::Hid, Input::Key(56), None),
        press(3, Route::Window { pid: TARGET, wid: 7, x: 1.0, y: 2.0 }, Input::Button(0), None),
        Record::Update { id: 3, route: Route::Window { pid: TARGET, wid: 7, x: 30.0, y: 40.5 } },
        press(4, Route::Hid, Input::Key(58), None),
        press(5, Route::Keyboard(TARGET), Input::Key(1), None),
        Record::Release { id: 5 },
    ]);
    println!("HELPER {}", child.id());
    std::io::stdout().flush().expect("stdout");
    let mut never = Vec::new();
    std::io::stdin().read_to_end(&mut never).expect("killed before stdin ends");
    drop(stream);
    child.wait().expect("the helper exits");
}

#[test]
fn a_killed_engine_leaves_the_helper_to_release_what_it_held() {
    // Given: an engine mid-request, holding keys and a dragged button, while
    // the user physically holds right Shift.
    let dir = tempfile::tempdir().expect("temp dir");
    let record = dir.path().join("releases");
    let mut engine = Command::new(std::env::current_exe().expect("test binary"))
        .args(["--ignored", "--exact", "engine_stand_in", "--nocapture", "--test-threads=1"])
        .env(STAND_IN_ENV, &record)
        .env(USER_HOLDS_ENV, "key:60")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("the engine stand-in starts");
    // libtest prints `test engine_stand_in ... ` without a newline before the
    // stand-in runs, so the marker is found anywhere in a line.
    let stdout = BufReader::new(engine.stdout.take().expect("stdout"));
    let (found, started) = mpsc::channel();
    thread::spawn(move || {
        let pid = stdout
            .lines()
            .find_map(|line| line.ok()?.rsplit_once("HELPER ")?.1.trim().parse::<libc::pid_t>().ok());
        found.send(pid).expect("the test waits");
    });
    let Ok(Some(helper)) = started.recv_timeout(HANG_GUARD) else {
        engine.kill().expect("the stand-in is stopped");
        engine.wait().expect("reaped");
        panic!("the stand-in never started a helper");
    };
    // SAFETY: getsid only reads the session of a live pid.
    assert_eq!(unsafe { libc::getsid(helper) }, helper, "the helper leads its own session");
    // When: its session gets a hangup and a terminate, then the engine dies.
    for signal in [libc::SIGHUP, libc::SIGTERM] {
        // SAFETY: the helper is alive: it still holds the stand-in's stream.
        assert_eq!(unsafe { libc::kill(helper, signal) }, 0);
    }
    engine.kill().expect("the engine is killed");
    engine.wait().expect("reaped");
    // Then: the helper releases and exits, closing the stderr it inherited.
    let mut stderr = engine.stderr.take().expect("stderr");
    let (done, exited) = mpsc::channel();
    thread::spawn(move || {
        let mut text = String::new();
        let read = stderr.read_to_string(&mut text).map(|_| text);
        done.send(read).expect("the test waits");
    });
    let stderr = exited.recv_timeout(HANG_GUARD).expect("the helper exits").expect("stderr reads");
    let releases = std::fs::read_to_string(record).unwrap_or_else(|error| panic!("no releases ({error}): {stderr}"));
    assert_eq!(releases.lines().collect::<Vec<_>>(), [
        "post 4 hid key:58 flags=0x20000",
        "post 3 window:4242:7@30,40.5 button:0 flags=-",
        "leave 2 hid key:56",
        "post 1 keyboard:4242 key:0 text=a flags=0x20000",
        "post 0 keyboard:4242 key:56 flags=0x0",
    ]);
}
