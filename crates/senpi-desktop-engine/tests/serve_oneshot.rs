#![cfg(unix)]
//! `--oneshot` clients against an auto-started `--serve` daemon with the fake
//! backend and a fake live Global listener: the daemon's own session, shared
//! frames, the stop latch, the user's `--resume`, and the host-only guard.

use std::io::Write;
use std::os::unix::fs::PermissionsExt;
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
        std::fs::create_dir_all(&dir).expect("temp dir");
        let socket = dir.join("engine.sock");
        Self { dir, socket }
    }

    fn command(&self, args: &[&str]) -> Command {
        let mut command = Command::new(BINARY);
        command
            .args(args)
            .args(["--endpoint", self.socket.to_str().expect("utf-8 path")])
            .env("SENPI_DESKTOP_BACKEND", format!("fake:{TWO_DISPLAYS}"))
            .env("SENPI_DESKTOP_FAKE_STOP_PATH", "live");
        command
    }

    fn oneshot(&self, request: &Value) -> Value {
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
        let output = child.wait_with_output().expect("oneshot exits");
        assert!(output.status.success(), "{output:?}");
        serde_json::from_slice(&output.stdout).expect("reply is one JSON line")
    }

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
    // When: client 1 captures, client 2 clicks against that frame.
    let captured = daemon.call(
        2,
        "desktop.capture",
        json!({"target": "desktop", "caps": {"maxWidth": 320}}),
    );
    let frame = captured["result"]["frameId"]
        .as_str()
        .expect("frame id")
        .to_owned();
    let clicked = daemon.call(
        3,
        "desktop.click",
        json!({"target": "desktop", "x": 10.0, "y": 10.0, "frameId": frame}),
    );
    assert!(clicked.get("error").is_none(), "{clicked}");
    // Then: stop latches, a click is Suspended, --resume re-enables.
    daemon.call(4, "desktop.stop", json!({}));
    let refused = daemon.call(
        5,
        "desktop.click",
        json!({"target": "desktop", "x": 10.0, "y": 10.0}),
    );
    assert_eq!(refused["error"]["data"]["code"], json!("Suspended"), "{refused}");
    let resumed = daemon.command(&["--resume"]).output().expect("--resume runs");
    assert!(resumed.status.success(), "{resumed:?}");
    // And: the Global path keeps beating; past the 2 s freshness window input is still admitted.
    std::thread::sleep(std::time::Duration::from_millis(2_500));
    let clicked_again = daemon.call(
        6,
        "desktop.click",
        json!({"target": "desktop", "x": 10.0, "y": 10.0}),
    );
    assert!(clicked_again.get("error").is_none(), "{clicked_again}");
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
