#![cfg(unix)]
//! `--serve` over a unix socket with the fake backend: concurrent same-uid
//! clients on the daemon's one shared session, idle exit, and the startup
//! rules of #12229 (endpoint directory, instance lock, stale socket, token).

use std::io::{BufRead, BufReader, Write};
use std::os::unix::fs::{DirBuilderExt, MetadataExt, PermissionsExt};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
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

/// A fresh 0700 directory under the temp dir, removed on drop.
struct PrivateDir(PathBuf);

impl PrivateDir {
    fn new(name: &str) -> Self {
        let dir = std::env::temp_dir().join(format!("senpi-serve-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::DirBuilder::new().mode(0o700).create(&dir).expect("private dir");
        Self(dir)
    }

    fn socket(&self) -> PathBuf {
        self.0.join("e.sock")
    }

    fn token(&self) -> PathBuf {
        self.0.join("e.resume")
    }
}

impl Drop for PrivateDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn serve_command(socket: &Path, idle_ms: u64) -> Command {
    let mut command = Command::new(BINARY);
    command
        .args([
            "--enable-daemon",
            "--serve",
            socket.to_str().expect("utf-8 path"),
            "--idle-ms",
            &idle_ms.to_string(),
        ])
        .env("SENPI_DESKTOP_BACKEND", format!("fake:{TWO_DISPLAYS}"))
        .env("SENPI_DESKTOP_FAKE_STOP_PATH", "live")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    command
}

/// Starts `--serve` and waits for its readiness line.
fn serve(socket: &Path, idle_ms: u64) -> Child {
    let mut child = serve_command(socket, idle_ms).spawn().expect("engine spawns");
    let mut stderr = BufReader::new(child.stderr.take().expect("stderr is piped"));
    let mut ready = String::new();
    stderr.read_line(&mut ready).expect("readiness line");
    assert!(ready.contains("serving on"), "{ready}");
    // Keep draining so a chatty daemon never blocks on a full pipe.
    thread::spawn(move || std::io::copy(&mut stderr, &mut std::io::sink()));
    child
}

/// Runs a `--serve` that must refuse; returns its stderr.
fn serve_refused(socket: &Path) -> String {
    let output = serve_command(socket, 300).output().expect("engine runs");
    assert!(!output.status.success(), "{output:?}");
    String::from_utf8_lossy(&output.stderr).into_owned()
}

fn exits_within_guard(mut child: Child) -> std::process::ExitStatus {
    let (sender, exited) = mpsc::channel();
    thread::spawn(move || sender.send(child.wait().expect("engine exits")));
    exited.recv_timeout(HANG_GUARD).expect("engine exits within the hang guard")
}

/// One raw NDJSON client of the daemon.
struct Client {
    writer: UnixStream,
    reader: BufReader<UnixStream>,
    notifications: Vec<Value>,
}

impl Client {
    fn connect(socket: &Path) -> Self {
        let stream = UnixStream::connect(socket).expect("client connects");
        stream.set_read_timeout(Some(HANG_GUARD)).expect("read timeout");
        Self {
            writer: stream.try_clone().expect("clone"),
            reader: BufReader::new(stream),
            notifications: Vec::new(),
        }
    }

    fn send(&mut self, id: i64, method: &str, params: Value) {
        let request = json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params});
        writeln!(self.writer, "{request}").expect("request written");
    }

    fn line(&mut self) -> Value {
        let mut line = String::new();
        self.reader.read_line(&mut line).expect("a line within the hang guard");
        serde_json::from_str(&line).unwrap_or_else(|error| panic!("{error}: {line:?}"))
    }

    /// The next reply, keeping the notifications that arrive before it.
    fn reply(&mut self) -> Value {
        loop {
            let line = self.line();
            if line.get("id").is_some() {
                return line;
            }
            self.notifications.push(line);
        }
    }

    fn call(&mut self, id: i64, method: &str, params: Value) -> Value {
        self.send(id, method, params);
        let reply = self.reply();
        assert_eq!(reply["id"], json!(id), "{reply}");
        reply
    }

    /// Waits for a `stopPath.changed` with `suspended`, skipping other lines.
    fn stop_changed(&mut self, suspended: bool) -> Value {
        let wanted = |line: &Value| line["method"] == json!("stopPath.changed") && line["params"]["suspended"] == json!(suspended);
        if let Some(found) = self.notifications.iter().position(wanted) {
            return self.notifications.remove(found);
        }
        loop {
            let line = self.line();
            if wanted(&line) {
                return line;
            }
        }
    }
}

#[test]
fn serve_shares_one_session_across_successive_clients_and_exits_when_idle() {
    // Given
    let dir = PrivateDir::new("successive");
    let socket = dir.socket();
    let child = serve(&socket, 2_000);
    // When: client 1 opens the session, client 2 uses it.
    let opened = Client::connect(&socket).call(1, "session.open", json!({}));
    let displays = Client::connect(&socket).call(2, "displays", json!({}));
    // Then
    assert_eq!(opened["result"]["capabilities"]["backend"], json!("fake"));
    assert_eq!(displays["result"].as_array().map(Vec::len), Some(2), "{displays}");
    assert!(exits_within_guard(child).success());
    assert!(!socket.exists(), "the socket file is removed at exit");
    assert!(!dir.token().exists(), "the token file is removed at exit");
}

#[test]
fn concurrent_clients_share_frames_stop_and_notifications_with_their_own_replies() {
    // Given: two clients connected at once.
    let dir = PrivateDir::new("concurrent");
    let socket = dir.socket();
    let child = serve(&socket, 2_000);
    let mut first = Client::connect(&socket);
    let mut second = Client::connect(&socket);
    // When / Then (T25-1): both complete engine.hello and capabilities.
    for client in [&mut first, &mut second] {
        let hello = client.call(1, "engine.hello", json!({}));
        assert_eq!(hello["result"]["protocolVersion"], json!("1"), "{hello}");
        let capabilities = client.call(2, "capabilities", json!({}));
        assert_eq!(capabilities["result"]["backend"], json!("fake"), "{capabilities}");
    }
    // T25-3: the same id on both connections, interleaved, gets each its own reply.
    first.send(7, "displays", json!({}));
    second.send(7, "windows", json!({}));
    let displays = first.reply();
    let windows = second.reply();
    assert_eq!(displays["result"].as_array().map(Vec::len), Some(2), "{displays}");
    assert_eq!(windows["result"][0]["id"], json!("101"), "{windows}");
    // T25-2: client 2 clicks a frame client 1 captured.
    let captured = first.call(3, "capture", json!({"target": "101", "caps": {"maxWidth": 320}}));
    let frame = captured["result"]["frameId"].as_str().expect("frame id").to_owned();
    let clicked = second.call(4, "click", json!({"target": "101", "x": 10.0, "y": 10.0, "frameId": frame}));
    assert!(clicked.get("error").is_none(), "{clicked}");
    // T25-14 residual pin: a raw same-uid client is answered for a host-only method.
    let heartbeat = second.call(5, "stopPath.heartbeat", json!({}));
    assert_ne!(heartbeat["error"]["data"]["reason"], json!("hostOnly"), "{heartbeat}");
    // T25-5 + T25-18: a stop from client 1 suspends client 2, and its notification reaches client 2.
    let stopped = first.call(6, "stopPath.stop", json!({"source": "api"}));
    assert!(stopped.get("error").is_none(), "{stopped}");
    let changed = second.stop_changed(true);
    assert_eq!(changed["params"]["stopPath"], json!("global"), "{changed}");
    let refused = second.call(8, "click", json!({"target": "101", "x": 10.0, "y": 10.0}));
    assert_eq!(refused["error"]["data"]["code"], json!("Suspended"), "{refused}");
    // T25-9: client 1 leaving does not end client 2.
    drop(first);
    let still = second.call(9, "displays", json!({}));
    assert!(still.get("error").is_none(), "{still}");
    drop(second);
    assert!(exits_within_guard(child).success());
}

#[test]
fn t25_4_exec_requests_from_two_clients_run_one_after_the_other() {
    // Given: two clients on the shared session.
    let dir = PrivateDir::new("fifo");
    let socket = dir.socket();
    let child = serve(&socket, 1_000);
    let mut first = Client::connect(&socket);
    let mut second = Client::connect(&socket);
    // When: each sends a one-second hold at once (the hold's duration is the behavior under test).
    let started = std::time::Instant::now();
    first.send(1, "holdKeys", json!({"target": "101", "keys": ["shift"], "duration": 1}));
    second.send(1, "holdKeys", json!({"target": "101", "keys": ["alt"], "duration": 1}));
    let replies = [first.reply(), second.reply()];
    // Then: both are answered on their own connection, and the second ran only
    // after the first released the exec permit.
    for reply in &replies {
        assert_eq!(reply["id"], json!(1), "{reply}");
        assert!(reply.get("error").is_none(), "{reply}");
    }
    assert!(started.elapsed() >= Duration::from_millis(1_900), "{:?}", started.elapsed());
    drop((first, second));
    assert!(exits_within_guard(child).success());
}

#[test]
fn t25_23_two_daemons_over_a_stale_socket_leave_exactly_one_serving() {
    // Given: a stale socket nobody answers at.
    let dir = PrivateDir::new("stale-race");
    let socket = dir.socket();
    drop(std::os::unix::net::UnixListener::bind(&socket).expect("stale bind"));
    // When: two daemons start together.
    let started: Vec<(Child, String)> = (0..2)
        .map(|_| serve_command(&socket, 1_000).spawn().expect("engine spawns"))
        .map(|mut child| {
            let mut stderr = BufReader::new(child.stderr.take().expect("stderr is piped"));
            let mut first = String::new();
            stderr.read_line(&mut first).expect("first stderr line");
            thread::spawn(move || std::io::copy(&mut stderr, &mut std::io::sink()));
            (child, first)
        })
        .collect();
    // Then: one serves, the other was refused the instance lock and exits non-zero.
    let (serving, refused): (Vec<_>, Vec<_>) = started.into_iter().partition(|(_, line)| line.contains("serving on"));
    assert_eq!((serving.len(), refused.len()), (1, 1), "{refused:?}");
    let (loser, line) = refused.into_iter().next().expect("loser");
    assert!(line.contains("instance lock"), "{line}");
    assert!(!exits_within_guard(loser).success());
    // And: the socket left is the winner's, and the token is the winner's.
    let mut client = Client::connect(&socket);
    let stopped = client.call(1, "stopPath.stop", json!({"source": "api"}));
    assert!(stopped.get("error").is_none(), "{stopped}");
    let resumed = Command::new(BINARY)
        .args(["--enable-daemon", "--resume", "--endpoint", socket.to_str().expect("utf-8 path")])
        .output()
        .expect("--resume runs");
    assert!(resumed.status.success(), "{resumed:?}");
    drop(client);
    let (winner, _) = serving.into_iter().next().expect("winner");
    assert!(exits_within_guard(winner).success());
}

#[test]
fn t25_10_idle_counts_from_the_last_disconnect() {
    // Given: a 1 s idle window.
    let dir = PrivateDir::new("idle");
    let socket = dir.socket();
    let child = serve(&socket, 1_000);
    let mut client = Client::connect(&socket);
    // When: the client stays connected well past the idle window (time is the behavior under test).
    thread::sleep(Duration::from_millis(3_000));
    // Then: the daemon is still serving it, and exits once it leaves.
    let displays = client.call(1, "displays", json!({}));
    assert!(displays.get("error").is_none(), "{displays}");
    drop(client);
    assert!(exits_within_guard(child).success());
    assert!(!socket.exists());
}

#[test]
fn t25_15_the_daemon_refuses_a_loose_or_symlinked_endpoint_directory() {
    // Given: a parent group and other can enter.
    let loose = PrivateDir::new("loose");
    std::fs::set_permissions(&loose.0, std::fs::Permissions::from_mode(0o755)).expect("chmod");
    // When / Then: no bind, no token.
    let stderr = serve_refused(&loose.socket());
    assert!(stderr.contains("group or other"), "{stderr}");
    assert!(!loose.socket().exists() && !loose.token().exists());
    // Given: a symlinked parent.
    let real = PrivateDir::new("real");
    let holder = PrivateDir::new("holder");
    let link = holder.0.join("link");
    std::os::unix::fs::symlink(&real.0, &link).expect("symlink");
    // When / Then
    let stderr = serve_refused(&link.join("e.sock"));
    assert!(stderr.contains("endpoint directory"), "{stderr}");
    assert!(!real.socket().exists() && !real.token().exists());
}

#[test]
fn t25_16_the_token_never_goes_through_a_symlink_or_into_an_existing_inode() {
    // Given: a symlink at the token path pointing at a victim file.
    let dir = PrivateDir::new("token-link");
    let victims = PrivateDir::new("victims");
    let victim = victims.0.join("victim");
    std::fs::write(&victim, "victim").expect("victim");
    std::os::unix::fs::symlink(&victim, dir.token()).expect("symlink");
    // When
    let child = serve(&dir.socket(), 300);
    // Then
    assert_eq!(std::fs::read_to_string(&victim).expect("victim"), "victim");
    let token = std::fs::symlink_metadata(dir.token()).expect("token");
    assert!(token.file_type().is_file(), "the token is a new regular file");
    assert_eq!(token.mode() & 0o777, 0o600);
    assert_eq!(token.uid(), std::fs::metadata(&dir.0).expect("dir").uid());
    assert!(exits_within_guard(child).success());
    // Given: a pre-existing regular file at the token path, its inode kept alive by a second link.
    let dir = PrivateDir::new("token-file");
    std::fs::write(dir.token(), "stale").expect("stale token");
    let kept = dir.0.join("kept");
    std::fs::hard_link(dir.token(), &kept).expect("second link");
    let stale = std::fs::metadata(dir.token()).expect("stale").ino();
    // When
    let child = serve(&dir.socket(), 300);
    // Then
    let token = std::fs::metadata(dir.token()).expect("token");
    assert_ne!(token.ino(), stale, "the token is a new inode");
    assert_eq!(token.mode() & 0o777, 0o600);
    assert_eq!(std::fs::read_to_string(&kept).expect("old inode"), "stale", "nothing was written into it");
    assert!(exits_within_guard(child).success());
}

#[test]
fn t25_22_a_second_daemon_on_a_live_endpoint_exits_and_leaves_the_live_one_alone() {
    // Given: a serving daemon with a connected client.
    let dir = PrivateDir::new("second");
    let socket = dir.socket();
    let child = serve(&socket, 1_000);
    let mut client = Client::connect(&socket);
    let inode = std::fs::metadata(&socket).expect("socket").ino();
    let token = std::fs::read(dir.token()).expect("token");
    // When
    let stderr = serve_refused(&socket);
    // Then
    assert!(stderr.contains("instance lock"), "{stderr}");
    assert_eq!(std::fs::metadata(&socket).expect("socket").ino(), inode);
    assert_eq!(std::fs::read(dir.token()).expect("token"), token);
    let displays = client.call(1, "displays", json!({}));
    assert!(displays.get("error").is_none(), "{displays}");
    drop(client);
    assert!(exits_within_guard(child).success());
}

#[test]
fn t25_20_a_restart_after_sigkill_replaces_the_stale_socket() {
    // Given: a daemon killed without its idle exit leaves its socket behind.
    let dir = PrivateDir::new("restart");
    let socket = dir.socket();
    let mut killed = serve(&socket, 5_000);
    killed.kill().expect("SIGKILL");
    killed.wait().expect("reaped");
    assert!(socket.exists(), "the stale socket is left behind");
    // When
    let child = serve(&socket, 2_000);
    // Then
    let displays = Client::connect(&socket).call(1, "displays", json!({}));
    assert!(displays.get("error").is_none(), "{displays}");
    assert!(exits_within_guard(child).success());
}

#[test]
fn t25_24_an_exiting_daemon_removes_only_the_socket_and_token_it_created() {
    // Given: the daemon's socket and token are replaced under it.
    let dir = PrivateDir::new("replaced");
    let socket = dir.socket();
    let child = serve(&socket, 300);
    std::fs::remove_file(&socket).expect("unlink socket");
    std::fs::write(&socket, "successor").expect("successor socket stand-in");
    std::fs::remove_file(dir.token()).expect("unlink token");
    std::fs::write(dir.token(), "successor").expect("successor token");
    // When
    assert!(exits_within_guard(child).success());
    // Then
    assert_eq!(std::fs::read_to_string(&socket).expect("kept"), "successor");
    assert_eq!(std::fs::read_to_string(dir.token()).expect("kept"), "successor");
}
