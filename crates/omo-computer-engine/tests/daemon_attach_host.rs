//! Row 29b (row 37's needs of the daemon, via the lead): an attach host (a `hand.register`-ed
//! peer holding its own connection) is refused every `HostOnly(authority)` method with
//! `hostOnly{peer_kind:"attach_host"}` and one audit line; its Public and `HostOnly(session)`
//! methods run on its OWN session as issuer `remote`; `--serve --start-stopped` starts suspended.
#![cfg(unix)]

#[path = "common/peer.rs"]
#[allow(dead_code)]
mod peer;
#[path = "common/daemon.rs"]
#[allow(dead_code)]
mod daemon;
#[path = "common/host.rs"]
#[allow(dead_code)]
mod host;

use daemon::Daemon;
use omo_computer_core::methods::{Exposure, PeerKind, METHODS};
use serde_json::json;

const ONE_WINDOW: &str = r#"{"windows":[{"id":"101","title":"t","app":"Notes","pid":4242,"x":0,"y":0,"width":800,"height":600,"focused":true,"elevated":null}]}"#;

/// A peer the authority registered, connected with its minted capability.
fn attach_host(daemon: &Daemon) -> daemon::Client {
    let mut authority = daemon.connect(&daemon.capability);
    let registered = authority
        .call(900, "hand.register", &json!({"pid": std::process::id(), "processStart": 0}))
        .expect("registered");
    let minted = registered["result"]["capability"].as_str().expect("a minted capability");
    let bytes: Vec<u8> = (0..32).map(|i| u8::from_str_radix(&minted[i * 2..i * 2 + 2], 16).expect("hex")).collect();
    daemon::Client::dial(&daemon.socket(), &bytes, bytes.clone().try_into().expect("32 bytes"))
}

#[test]
fn every_authority_method_is_host_only_for_an_attach_host_with_one_audit_line() {
    let daemon = Daemon::start(&[]);
    let mut peer = attach_host(&daemon);
    let authority_only: Vec<&str> = METHODS
        .iter()
        .filter(|spec| spec.exposure == Exposure::HostOnly(PeerKind::Authority))
        .map(|spec| spec.name)
        .filter(|name| *name != "desktop.shutdown")
        .collect();
    assert!(authority_only.contains(&"stopPath.resume") && authority_only.contains(&"control.acquire"));
    for (id, name) in (1_i64..).zip(&authority_only) {
        let reply = peer.call(id, name, &json!({})).unwrap_or_else(|| panic!("{name}: answered"));
        assert_eq!(reply["error"]["code"], -32_601, "{name}: {reply}");
        assert_eq!(reply["error"]["data"], json!({"reason": "hostOnly", "peer_kind": "attach_host"}), "{name}: {reply}");
    }
    let stderr = daemon.stderr();
    for name in &authority_only {
        let lines = stderr.lines().filter(|line| line.contains(&format!("audit: {name} refused hostOnly"))).count();
        assert_eq!(lines, 1, "{name}: one audit line each:\n{stderr}");
    }
}

#[test]
fn an_attach_host_runs_public_and_session_methods_on_its_own_session_as_remote() {
    let daemon = Daemon::start_with(ONE_WINDOW, &[]);
    host::consent(daemon.dir.path(), true);
    let mut peer = attach_host(&daemon);
    for (id, name) in [(1, "engine.hello"), (2, "session.open"), (3, "capabilities")] {
        let reply = peer.call(id, name, &json!({})).unwrap_or_else(|| panic!("{name}: answered"));
        assert!(reply.get("result").is_some(), "{name}: {reply}");
    }
    let click = peer
        .call(4, "click", &json!({"target": "101", "x": 10, "y": 10, "callId": "attach-host-probe"}))
        .expect("answered");
    assert!(click.get("error").is_none(), "{click}");
    let audit = audit_lines(daemon.dir.path(), "attach-host-probe");
    assert!(!audit.is_empty(), "the click is audited");
    assert!(audit.iter().all(|line| line.contains("\"issuer\":\"remote\"")), "{audit:?}");
}

#[test]
fn start_stopped_flag_starts_suspended() {
    let daemon = Daemon::start_with_args(ONE_WINDOW, &[], &["--start-stopped"]);
    host::consent(daemon.dir.path(), true);
    let mut authority = daemon.connect(&daemon.capability);
    let opened = authority.call(1, "session.open", &json!({})).expect("answered");
    assert!(opened.get("result").is_some(), "{opened}");
    let click = authority.call(2, "click", &json!({"target": "101", "x": 10, "y": 10})).expect("answered");
    assert_eq!(click["error"]["data"]["code"], "Suspended", "a daemon started stopped refuses input: {click}");
}

fn audit_lines(dir: &std::path::Path, needle: &str) -> Vec<String> {
    let mut found = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(path) = stack.pop() {
        if path.is_dir() {
            stack.extend(std::fs::read_dir(&path).into_iter().flatten().filter_map(Result::ok).map(|e| e.path()));
        } else if let Ok(text) = std::fs::read_to_string(&path) {
            found.extend(text.lines().filter(|l| l.contains(needle) && l.contains("\"issuer\"")).map(str::to_owned));
        }
    }
    found
}

