//! Row 29: the `--serve` daemon - concurrent same-uid clients, the after-accept peer check, the
//! raw 32-byte capability preamble plus the capability on every request (lead decision Q2 C),
//! `hand.register` (Q1 A), the fake-peer verdict seam (Q3 A), the push outbox, the lock, idle exit.
#![cfg(unix)]

#[path = "common/peer.rs"]
#[allow(dead_code)]
mod peer;
#[path = "common/daemon.rs"]
mod daemon;

use std::time::{Duration, Instant};

use daemon::{hex, Daemon};
use serde_json::json;

fn opened(daemon: &Daemon) -> daemon::Client {
    let mut client = daemon.connect(&daemon.capability);
    let reply = client.call(1, "session.open", &json!({})).expect("the bound client is answered");
    assert!(reply.get("result").is_some(), "{reply}");
    client
}

#[test]
fn a_wrong_preamble_closes_unauthorized_with_no_frame_decoded() {
    let daemon = Daemon::start(&[]);
    let mut client = daemon.connect(&[0u8; 32]);
    client.send_with(1, "session.open", &json!({}), None);
    assert!(client.closed_silently(), "a wrong preamble gets no reply and is closed");
}

#[test]
fn capability_required_on_every_request() {
    let daemon = Daemon::start(&[]);
    let mut client = opened(&daemon);
    client.send_with(2, "capabilities", &json!({}), Some(&hex(&[9u8; 32])));
    let reply = client.read_reply(2);
    assert!(reply.as_ref().is_none_or(|r| r["error"]["data"]["code"] == "unauthorized"), "{reply:?}");
}

#[test]
fn cross_connection_capability_refused() {
    let daemon = Daemon::start(&[]);
    let mut first = opened(&daemon);
    let registered = first
        .call(2, "hand.register", &json!({"pid": std::process::id(), "processStart": 0}))
        .expect("the authority connection registers a peer");
    let minted = registered["result"]["capability"].as_str().expect("a minted capability").to_owned();
    let mut other = daemon.connect(&daemon.capability);
    other.send_with(3, "capabilities", &json!({}), Some(&minted));
    let reply = other.read_reply(3);
    assert!(reply.as_ref().is_none_or(|r| r["error"]["data"]["code"] == "unauthorized"), "{reply:?}");
}

#[test]
fn a_registered_peer_cannot_register_another() {
    let daemon = Daemon::start(&[]);
    let mut authority = opened(&daemon);
    let reply = authority
        .call(2, "hand.register", &json!({"pid": std::process::id(), "processStart": 0}))
        .expect("registered");
    let minted = reply["result"]["capability"].as_str().expect("capability");
    let bytes: Vec<u8> = (0..32).map(|i| u8::from_str_radix(&minted[i * 2..i * 2 + 2], 16).expect("hex")).collect();
    let mut peer = daemon::Client::dial(&daemon.socket(), &bytes, bytes.clone().try_into().expect("32"));
    let refused = peer.call(3, "hand.register", &json!({"pid": 1, "processStart": 0})).expect("answered");
    assert_eq!(refused["error"]["code"], -32_601, "{refused}");
    assert_eq!(refused["error"]["data"]["peer_kind"], "attach_host", "{refused}");
}

#[test]
fn peer_uid_mismatch_is_refused_after_accept() {
    let daemon = Daemon::start(&[]);
    std::fs::write(daemon.dir.path().join("fake-peer"), "foreign-uid").expect("verdict");
    let mut client = daemon.connect(&daemon.capability);
    client.send_with(1, "session.open", &json!({}), None);
    assert!(client.closed_silently(), "a foreign uid is closed before any frame");
}

#[test]
fn a_real_backend_daemon_ignores_the_fake_peer_verdict_file() {
    let daemon = Daemon::start(&[("OMO_COMPUTER_BACKEND", "linux")]);
    std::fs::write(daemon.dir.path().join("fake-peer"), "foreign-uid").expect("verdict");
    let mut client = daemon.connect(&daemon.capability);
    let reply = client.call(1, "capabilities", &json!({}));
    assert!(reply.is_some(), "the real path never reads the verdict: the frame is decoded and answered");
}

#[test]
fn same_uid_unregistered_peer_refused_unauthorized() {
    let daemon = Daemon::start(&[]);
    std::fs::write(daemon.dir.path().join("fake-peer"), "unregistered").expect("verdict");
    let mut client = daemon.connect(&daemon.capability);
    client.send_with(1, "session.open", &json!({"consent": {"tier": "exec"}}), None);
    assert!(client.closed_silently(), "an unregistered pid is closed before any frame");
}

#[test]
fn two_clients_one_daemon_stuck_capture_does_not_block_the_other() {
    let mut slow: serde_json::Value = serde_json::from_str(daemon::ONE_WINDOW).expect("scenario");
    slow["delay_ms"] = json!({"capture": 3000});
    let daemon = Daemon::start_with(&slow.to_string(), &[]);
    let mut stuck = opened(&daemon);
    stuck.send_with(2, "capture", &json!({"target": "101"}), None);
    let mut other = opened(&daemon);
    let started = Instant::now();
    let reply = other.call(3, "capabilities", &json!({})).expect("answered");
    assert!(reply.get("result").is_some() && started.elapsed() < Duration::from_secs(1), "{reply}");
    let captured = stuck.read_reply(2).expect("the stuck capture still answers");
    assert!(captured.get("result").is_some(), "{captured}");
}

#[test]
fn notification_reaches_every_subscriber_within_idle_flush() {
    let daemon = Daemon::start(&[]);
    let mut idle = opened(&daemon);
    let mut actor = opened(&daemon);
    actor.call(2, "stopPath.stop", &json!({"source": "test"})).expect("stopped");
    let started = Instant::now();
    let note = std::iter::from_fn(|| idle.next_message()).find(|m| m["method"] == "stopPath.changed");
    assert!(note.is_some() && started.elapsed() < Duration::from_secs(1), "{note:?}");
}

#[test]
fn second_daemon_start_loses_the_lock() {
    let first = Daemon::start(&[]);
    let status = std::process::Command::new(peer::engine())
        .args(["--enable-daemon", "--serve", "--endpoint"])
        .arg(first.dir.path().join("second.sock"))
        .arg("--lock")
        .arg(first.dir.path().join("engine.lock"))
        .env("OMO_COMPUTER_BACKEND", "fake")
        .stdin(std::process::Stdio::null())
        .status()
        .expect("runs");
    assert!(!status.success(), "the second start must lose the lock");
}

#[test]
fn hello_carries_the_daemon_generation() {
    let daemon = Daemon::start(&[]);
    let mut client = daemon.connect(&daemon.capability);
    let hello = client.call(1, "engine.hello", &json!({})).expect("hello");
    assert!(hello["result"]["generation"].is_string() || hello["result"]["generation"].is_u64(), "{hello}");
}

#[test]
fn desktop_shutdown_is_host_only_and_ends_the_daemon() {
    let mut daemon = Daemon::start(&[]);
    let mut client = opened(&daemon);
    client.call(2, "desktop.shutdown", &json!({})).expect("acknowledged");
    let deadline = Instant::now() + Duration::from_secs(2);
    while daemon.child.try_wait().expect("wait").is_none() {
        assert!(Instant::now() < deadline, "the daemon did not exit after desktop.shutdown");
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// The client side of the real-process test, run only as a re-executed child of it.
#[test]
#[ignore = "run by same_uid_unregistered_real_process_is_closed_unread as its child"]
fn unregistered_client_helper() {
    let (Ok(socket), Ok(capability)) = (std::env::var("W1E_DIAL"), std::env::var("W1E_CAP")) else { return };
    let bytes: Vec<u8> = (0..32).map(|i| u8::from_str_radix(&capability[i * 2..i * 2 + 2], 16).expect("hex")).collect();
    let mut client = daemon::Client::dial(std::path::Path::new(&socket), &bytes, bytes.clone().try_into().expect("32"));
    client.send_with(1, "session.open", &json!({}), None);
    println!("{}", if client.closed_silently() { "CLOSED-UNREAD" } else { "ANSWERED" });
}

#[test]
fn same_uid_unregistered_real_process_is_closed_unread() {
    let daemon = Daemon::start(&[]);
    let output = std::process::Command::new(std::env::current_exe().expect("test binary"))
        .args(["--exact", "unregistered_client_helper", "--ignored", "--nocapture"])
        .env("W1E_DIAL", daemon.socket())
        .env("W1E_CAP", hex(&daemon.capability))
        .output()
        .expect("the second process runs");
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("CLOSED-UNREAD"), "a same-uid pid not on the allowlist, even holding the generation capability: {stdout}");
}

#[test]
fn launcher_killed_alone_ends_the_daemon_within_2s() {
    let mut daemon = Daemon::start(&[]);
    drop(daemon.child.stdin.take());
    let deadline = Instant::now() + Duration::from_secs(2);
    while daemon.child.try_wait().expect("wait").is_none() {
        assert!(Instant::now() < deadline, "the daemon outlived its launcher's pipe");
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn machine_id_over(args: &[&str], method: &str, daemon: &Daemon) -> serde_json::Value {
    let env: Vec<(String, String)> = vec![
        ("OMO_COMPUTER_BACKEND".to_owned(), "fake".to_owned()),
        ("OMO_COMPUTER_RUNTIME_DIR".to_owned(), daemon.dir.path().to_string_lossy().into_owned()),
        ("OMO_COMPUTER_FAKE_SCENARIO".to_owned(), daemon.dir.path().join("scenario.json").to_string_lossy().into_owned()),
        ("OMO_COMPUTER_FAKE_STOP_PATH".to_owned(), "live".to_owned()),
    ];
    let mut engine = peer::Peer::spawn(args, &env, daemon.dir.path());
    engine.send(&json!({"jsonrpc": "2.0", "id": 1, "method": method, "params": {}}));
    let reply = engine.next().expect("hello is answered");
    drop(engine.close());
    reply["result"]["machineId"].clone()
}

#[test]
fn hello_machine_id_matches_across_stdio_serve_and_oneshot() {
    let daemon = Daemon::start(&[]);
    let served = daemon.connect(&daemon.capability).call(1, "engine.hello", &json!({})).expect("hello")["result"]["machineId"].clone();
    assert!(served.is_string(), "{served}");
    assert_eq!(machine_id_over(&["--stdio"], "engine.hello", &daemon), served);
    // --oneshot speaks the v1 `desktop.*` names (corpus case 09).
    assert_eq!(machine_id_over(&["--oneshot"], "desktop.engine.hello", &daemon), served);
}

#[test]
fn a_stop_from_one_connection_suspends_every_session() {
    let daemon = Daemon::start(&[]);
    let mut idle = opened(&daemon);
    let mut actor = opened(&daemon);
    for client in [&mut idle, &mut actor] {
        let started = client.call(5, "stopPath.start", &json!({"chord": "ctrl+alt+shift+escape"})).expect("armed");
        assert!(started.get("result").is_some(), "{started}");
    }
    actor.call(2, "stopPath.stop", &json!({"source": "test"})).expect("stopped");
    let status = idle.call(3, "stopPath.status", &json!({})).expect("status");
    assert_eq!(status["result"]["suspended"], true, "a stop is hand-wide: {status}");
}

#[test]
fn daemon_refuses_sibling_host_terminal_self_target() {
    let host_terminal = std::os::unix::process::parent_id();
    let scenario = json!({"windows": [{"id": "301", "title": "the host's terminal", "app": "Terminal",
        "pid": host_terminal, "x": 0, "y": 0, "width": 400, "height": 300, "focused": true, "elevated": null}],
        "ax": {}});
    let daemon = Daemon::start_with(&scenario.to_string(), &[]);
    let mut client = opened(&daemon);
    client.call(5, "stopPath.start", &json!({"chord": "ctrl+alt+shift+escape"})).expect("armed");
    let typed = client.call(2, "typeText", &json!({"target": "301", "text": "rm -rf ~"})).expect("answered");
    assert!(typed.get("error").is_some(), "{typed}");
    assert_eq!(typed["error"]["data"]["reason"], "self_target", "{typed}");
}
