#![cfg(unix)]
//! `--oneshot` clients against an auto-started `--serve` daemon with the fake
//! backend and a fake live Global listener: the daemon's own session, shared
//! frames, the stop latch, the user's `--resume`, and the host-only guard.

use std::io::Write;
use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde_json::{json, Value};

const BINARY: &str = env!("CARGO_BIN_EXE_senpi-desktop-engine");
const TWO_DISPLAYS: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../senpi-desktop-backend-fake/fixtures/two-displays-one-window.json"
);

struct Daemon {
    dir: PathBuf,
    socket: PathBuf,
}

impl Daemon {
    fn new(name: &str) -> Self {
        let dir = std::env::temp_dir().join(format!("senpi-oneshot-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::DirBuilder::new().mode(0o700).create(&dir).expect("private temp dir");
        let socket = dir.join("engine.sock");
        Self { dir, socket }
    }

    fn command(&self, args: &[&str]) -> Command {
        let mut command = Command::new(BINARY);
        command
            .arg("--enable-daemon")
            .args(args)
            .args(["--endpoint", self.socket.to_str().expect("utf-8 path")])
            .env("SENPI_DESKTOP_BACKEND", format!("fake:{TWO_DISPLAYS}"))
            .env("SENPI_DESKTOP_FAKE_STOP_PATH", "live");
        command
    }

    fn oneshot(&self, request: &Value) -> Value {
        finish(self.spawn_oneshot(request))
    }

    fn spawn_oneshot(&self, request: &Value) -> std::process::Child {
        let mut child = self
            .command(&[
                "--oneshot",
                "--idle-ms",
                "3000",
                "--audit-path",
                self.dir.join("audit.jsonl").to_str().expect("utf-8 path"),
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .expect("oneshot spawns");
        writeln!(child.stdin.take().expect("stdin"), "{request}").expect("request written");
        child
    }

    /// Two `--oneshot` clients at once, both finding no daemon: both replies
    /// come from one daemon whose token `--resume` accepts.
    fn race_two_auto_starts(&self) {
        let racers: Vec<_> = (1..=2)
            .map(|id| self.spawn_oneshot(&json!({"jsonrpc": "2.0", "id": id, "method": "desktop.stopPath.status"})))
            .collect();
        for racer in racers {
            let status = finish(racer);
            assert_eq!(status["result"]["stopPath"], json!("global"), "{status}");
        }
        let stopped = self.call(10, "desktop.stop", json!({}));
        assert!(stopped.get("error").is_none(), "{stopped}");
        let resumed = self.command(&["--resume"]).output().expect("--resume runs");
        assert!(resumed.status.success(), "{resumed:?}");
        let status = self.call(11, "desktop.stopPath.status", json!({}));
        assert_eq!(status["result"]["suspended"], json!(false), "{status}");
    }
}

fn finish(child: std::process::Child) -> Value {
    let output = child.wait_with_output().expect("oneshot exits");
    assert!(output.status.success(), "{output:?}");
    serde_json::from_slice(&output.stdout).expect("reply is one JSON line")
}

impl Daemon {

    fn call(&self, id: i64, method: &str, params: Value) -> Value {
        self.oneshot(&json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}))
    }
}

impl Drop for Daemon {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn token_file(socket: &Path) -> PathBuf {
    socket.with_extension("resume")
}

#[test]
fn serve_oneshot_daemon_session_shared_frames_stop_resume_and_host_only_guard() {
    let daemon = Daemon::new("flow");
    // Given: the first oneshot auto-starts the daemon, which opened its own session.
    let status = daemon.call(1, "desktop.stopPath.status", json!({}));
    assert_eq!(status["result"]["stopPath"], json!("global"), "{status}");
    let mode = std::fs::metadata(token_file(&daemon.socket))
        .expect("token file")
        .permissions()
        .mode();
    assert_eq!(mode & 0o777, 0o600);
    // When: client 1 captures, client 2 clicks against that frame. Desktop input
    // needs the host-only control grant (#10788), so the bridge clicks a window.
    let captured = daemon.call(
        2,
        "desktop.capture",
        json!({"target": "101", "caps": {"maxWidth": 320}}),
    );
    let frame = captured["result"]["frameId"]
        .as_str()
        .expect("frame id")
        .to_owned();
    let clicked = daemon.call(
        3,
        "desktop.click",
        json!({"target": "101", "x": 10.0, "y": 10.0, "frameId": frame}),
    );
    assert!(clicked.get("error").is_none(), "{clicked}");
    // And: a bridge client cannot obtain the host-only grant, so desktop input
    // is refused before any input (#10788).
    let desktop = daemon.call(
        31,
        "desktop.click",
        json!({"target": "desktop", "x": 10.0, "y": 10.0}),
    );
    assert_eq!(desktop["error"]["data"]["code"], json!("ControlRequired"), "{desktop}");
    // Then: stop latches, a click is Suspended, --resume re-enables.
    daemon.call(4, "desktop.stop", json!({}));
    let refused = daemon.call(
        5,
        "desktop.click",
        json!({"target": "101", "x": 10.0, "y": 10.0}),
    );
    assert_eq!(refused["error"]["data"]["code"], json!("Suspended"), "{refused}");
    let resumed = daemon.command(&["--resume"]).output().expect("--resume runs");
    assert!(resumed.status.success(), "{resumed:?}");
    // And: the Global path keeps beating; past the 2 s freshness window input is still admitted.
    std::thread::sleep(std::time::Duration::from_millis(2_500));
    let clicked_again = daemon.call(
        6,
        "desktop.click",
        json!({"target": "101", "x": 10.0, "y": 10.0}),
    );
    assert!(clicked_again.get("error").is_none(), "{clicked_again}");
    // And: resume never manufactures consent for desktop input.
    let desktop_after_resume = daemon.call(
        61,
        "desktop.click",
        json!({"target": "desktop", "x": 10.0, "y": 10.0}),
    );
    assert_eq!(
        desktop_after_resume["error"]["data"]["code"],
        json!("ControlRequired"),
        "{desktop_after_resume}"
    );
    // And: host-only lines never cross the bridge; a string id is echoed verbatim.
    for method in [
        "desktop.stopPath.resume",
        "desktop.stopPath.start",
        "desktop.session.open",
    ] {
        let rejected = daemon.call(7, method, json!({}));
        assert_eq!(
            rejected["error"]["data"]["reason"],
            json!("hostOnly"),
            "{method}: {rejected}"
        );
    }
    let echoed = daemon.oneshot(&json!({"jsonrpc": "2.0", "id": "1", "method": "desktop.capabilities"}));
    assert_eq!(echoed["id"], json!("1"));
    let stopped = daemon.call(8, "desktop.stop", json!({}));
    assert!(stopped.get("error").is_none(), "{stopped}");
}

#[test]
fn t25_19_two_clients_that_find_no_daemon_leave_one_serving_daemon() {
    // Given
    let daemon = Daemon::new("cold-race");
    // When / Then
    daemon.race_two_auto_starts();
}

#[test]
fn t25_26_two_auto_starts_after_a_sigkill_leave_one_serving_daemon() {
    // Given: a daemon killed without its exit cleanup leaves its socket behind.
    let daemon = Daemon::new("kill-race");
    let mut killed = Command::new(BINARY)
        .args(["--enable-daemon", "--serve", daemon.socket.to_str().expect("utf-8 path"), "--idle-ms", "5000"])
        .env("SENPI_DESKTOP_BACKEND", format!("fake:{TWO_DISPLAYS}"))
        .env("SENPI_DESKTOP_FAKE_STOP_PATH", "live")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .expect("engine spawns");
    let mut ready = String::new();
    std::io::BufRead::read_line(
        &mut std::io::BufReader::new(killed.stderr.take().expect("stderr")),
        &mut ready,
    )
    .expect("readiness line");
    assert!(ready.contains("serving on"), "{ready}");
    killed.kill().expect("SIGKILL");
    killed.wait().expect("reaped");
    assert!(daemon.socket.exists(), "the stale socket is left behind");
    // When / Then
    daemon.race_two_auto_starts();
}

/// T25-24: the test holds the instance lock the way an idle-exiting daemon
/// does, waits (inotify) until the client's first start was refused it, then
/// releases it; the client's start retry brings a daemon up.
#[cfg(target_os = "linux")]
#[test]
fn t25_24_a_start_refused_the_instance_lock_is_started_again() {
    use std::os::fd::AsRawFd;

    // Given: the instance lock is held and watched for a daemon closing it.
    let daemon = Daemon::new("lock-retry");
    let lock_path = daemon.socket.with_extension("lock");
    let lock = std::fs::File::create(&lock_path).expect("lock file");
    // SAFETY: `lock` is an open file descriptor for the duration of the call.
    assert_eq!(unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX) }, 0);
    // SAFETY: inotify_init1 has no memory preconditions.
    let watch = unsafe { libc::inotify_init1(libc::IN_CLOEXEC) };
    assert!(watch >= 0);
    let path = std::ffi::CString::new(lock_path.to_str().expect("utf-8 path")).expect("no NUL");
    // SAFETY: `path` is a NUL-terminated string that outlives the call.
    assert!(unsafe { libc::inotify_add_watch(watch, path.as_ptr(), libc::IN_CLOSE_WRITE) } >= 0);
    // When: a client finds no daemon and starts one, which is refused the lock.
    let client = daemon.spawn_oneshot(&json!({"jsonrpc": "2.0", "id": 1, "method": "desktop.stopPath.status"}));
    let mut poll = libc::pollfd { fd: watch, events: libc::POLLIN, revents: 0 };
    // SAFETY: `poll` is one valid pollfd.
    assert_eq!(unsafe { libc::poll(&raw mut poll, 1, 30_000) }, 1, "a refused start closed the lock file");
    drop(lock);
    // SAFETY: `watch` is the inotify fd opened above.
    unsafe { libc::close(watch) };
    // Then: the start retry serves the client.
    let status = finish(client);
    assert_eq!(status["result"]["stopPath"], json!("global"), "{status}");
}
