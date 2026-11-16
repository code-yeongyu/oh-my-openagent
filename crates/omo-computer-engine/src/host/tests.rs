use std::io::{BufRead, BufReader, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::UnixListener;
use std::path::Path;

use omo_computer_core::host_paths::{HostAddress, HostPaths};
use serde_json::json;

use super::*;

fn paths(dir: &Path) -> HostPaths {
    HostPaths {
        config: dir.to_path_buf(),
        address: HostAddress::Socket(dir.join("host-api.sock")),
    }
}

fn owner_only_dir() -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("dir");
    std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o700)).expect("0700");
    dir
}

fn write_0600(path: &Path, text: &str) {
    std::fs::create_dir_all(path.parent().expect("parent")).expect("parent dir");
    std::fs::set_permissions(path.parent().expect("parent"), std::fs::Permissions::from_mode(0o700))
        .expect("0700");
    std::fs::write(path, text).expect("file");
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).expect("0600");
}

fn host_answering(dir: &Path, suspended: bool) {
    let listener = UnixListener::bind(dir.join("host-api.sock")).expect("bind");
    std::thread::spawn(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            let mut line = String::new();
            let _ = BufReader::new(stream.try_clone().expect("clone")).read_line(&mut line);
            let reply = json!({"jsonrpc": "2.0", "id": 1, "result": {"consentFingerprint": "fp", "latch": {"suspended": suspended, "stopEpoch": 3}}});
            let _ = writeln!(stream, "{reply}");
        }
    });
}

#[test]
fn no_listener_and_no_latch_file_is_file_only() {
    let dir = owner_only_dir();
    assert_eq!(read(&paths(dir.path()), true).latch, LatchOutcome::FileOnly);
}

#[test]
fn a_set_latch_file_latches_before_any_dial() {
    let dir = owner_only_dir();
    write_0600(&dir.path().join("computer/host-latch"), r#"{"suspended":true,"stopEpoch":7}"#);
    assert!(read(&paths(dir.path()), true).latch.is_set());
}

#[test]
fn an_unparseable_latch_file_is_set() {
    let dir = owner_only_dir();
    write_0600(&dir.path().join("computer/host-latch"), "{");
    assert!(read(&paths(dir.path()), true).latch.is_set());
}

#[test]
fn an_unverified_unlatched_reply_cannot_loosen() {
    let dir = owner_only_dir();
    host_answering(dir.path(), false);
    let view = read(&paths(dir.path()), true);
    assert!(view.latch.is_set(), "{view:?}");
    assert_eq!(view.authority, Authority::FileOnly);
}

#[test]
fn a_verified_unlatched_reply_clears_and_reads_host_authority() {
    let dir = owner_only_dir();
    write_0600(&dir.path().join("fake-host-identity"), "pass");
    host_answering(dir.path(), false);
    let view = read(&paths(dir.path()), true);
    assert_eq!(view.latch, LatchOutcome::Clear { fingerprint: "fp".to_owned() });
    assert_eq!(view.authority, Authority::Host);
}

#[test]
fn any_latched_reply_tightens_whoever_sent_it() {
    let dir = owner_only_dir();
    host_answering(dir.path(), true);
    assert!(read(&paths(dir.path()), true).latch.is_set());
}

#[test]
fn a_silent_listener_is_set_within_the_budget() {
    let dir = owner_only_dir();
    let _listener = UnixListener::bind(dir.path().join("host-api.sock")).expect("bind");
    let started = std::time::Instant::now();
    assert!(read(&paths(dir.path()), true).latch.is_set());
    assert!(started.elapsed() < std::time::Duration::from_millis(2_500), "{:?}", started.elapsed());
}

#[test]
fn a_permissive_config_dir_is_set() {
    let dir = owner_only_dir();
    std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o775)).expect("0775");
    assert!(read(&paths(dir.path()), true).latch.is_set());
}

#[test]
fn the_host_latch_refusal_is_suspended_with_nothing_sent() {
    let refusal = HostLatch::refusal();
    assert_eq!(refusal.code, EngineCode::Suspended.number());
    let data = refusal.data.expect("data");
    assert_eq!((data["reason"].clone(), data["nothingSent"].clone()), (json!("host_latch"), json!(true)));
}
