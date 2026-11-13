//! The hand tool host's side as a host-less engine sees it, scripted for row 28's tests against
//! DESIGN-GAPS-ROW28 revision 2 (PROPOSED): the local API listener answering `hand.status`, the
//! persisted `host-latch` file, the listener identity the fake trait reports, and the hand's
//! `consent.json`. Under the test seam every file sits under `OMO_COMPUTER_RUNTIME_DIR`.

use std::fs;
use std::io::{BufRead, BufReader, Write};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::UnixListener;
use std::path::Path;
use std::thread;

use serde_json::{json, Value};

#[cfg(not(target_os = "linux"))]
pub const HOST_API: &str = "host-api.sock";
pub const HOST_LATCH: &str = "computer/host-latch";
pub const FAKE_IDENTITY: &str = "fake-host-identity";
pub const CONSENT: &str = "computer/consent.json";

pub fn status(suspended: bool, stop_epoch: u64) -> Value {
    json!({"consentFingerprint": "fp-test", "latch": {"suspended": suspended, "stopEpoch": stop_epoch}})
}

fn write_0600(path: &Path, text: &str) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("the parent dir");
    }
    fs::write(path, text).expect("the file is written");
    #[cfg(unix)]
    fs::set_permissions(path, fs::Permissions::from_mode(0o600)).expect("0600");
}

#[cfg(not(target_os = "linux"))]
fn bind(runtime: &Path) -> UnixListener {
    UnixListener::bind(runtime.join(HOST_API)).expect("the host socket binds")
}

/// Linux (revision 2, item 1): the abstract name `omo-host-api-<uid>`, under the test seam with a
/// suffix from the runtime dir (PROPOSED: the first 16 hex digits of SHA-256 over its path).
#[cfg(target_os = "linux")]
fn bind(runtime: &Path) -> UnixListener {
    use sha2::{Digest, Sha256};
    use std::os::linux::net::SocketAddrExt;
    use std::os::unix::fs::MetadataExt;
    use std::os::unix::net::SocketAddr;
    let uid = fs::metadata(runtime).expect("the runtime dir").uid();
    let digest = Sha256::digest(runtime.to_string_lossy().as_bytes());
    let suffix: String = digest.iter().take(8).map(|byte| format!("{byte:02x}")).collect();
    let name = format!("omo-host-api-{uid}-{suffix}");
    let addr = SocketAddr::from_abstract_name(name.as_bytes()).expect("an abstract name");
    UnixListener::bind_addr(&addr).expect("the host name binds")
}

/// `pass`, `fail` or `foreign-uid`: what the engine's fake listener-identity check reports.
pub fn identity(runtime: &Path, verdict: &str) {
    write_0600(&runtime.join(FAKE_IDENTITY), verdict);
}

pub fn latch_file(runtime: &Path, suspended: bool, stop_epoch: u64) {
    let latch = json!({"suspended": suspended, "stopEpoch": stop_epoch, "lineHash": "0".repeat(64)});
    write_0600(&runtime.join(HOST_LATCH), &latch.to_string());
}

pub fn consent(runtime: &Path, computer_use: bool) {
    let file = json!({"v": 1, "computerUse": computer_use, "remoteCommands": true, "foreground": "policy",
        "apps": {"allow": [], "deny": [], "mentions": []}, "protectedTableVersion": 3,
        "stopHotkey": "ctrl+alt+shift+escape", "foregroundInputLock": false, "waylandPersistConsent": null});
    write_0600(&runtime.join(CONSENT), &file.to_string());
}

pub fn serve(runtime: &Path, replies: Vec<Value>) {
    assert!(!replies.is_empty(), "a scripted host needs a reply");
    let listener = bind(runtime);
    thread::spawn(move || {
        let mut served = 0_usize;
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { return };
            let Ok(reader) = stream.try_clone() else { continue };
            for line in BufReader::new(reader).lines() {
                let Ok(request) = line.map(|line| serde_json::from_str::<Value>(&line).unwrap_or(Value::Null)) else { break };
                let result = replies.get(served).or_else(|| replies.last()).cloned().unwrap_or(Value::Null);
                served += 1;
                let reply = json!({"jsonrpc": "2.0", "id": request["id"], "result": result});
                if writeln!(stream, "{reply}").and_then(|()| stream.flush()).is_err() {
                    break;
                }
            }
        }
    });
}

pub fn setup(runtime: &Path, block: &Value) {
    if let Some(verdict) = block["identity"].as_str() {
        identity(runtime, verdict);
    }
    if let Some(latch) = block.get("latchFile") {
        latch_file(runtime, latch["suspended"] == json!(true), latch["stopEpoch"].as_u64().unwrap_or(0));
    }
    if let Some(computer_use) = block["consent"]["computerUse"].as_bool() {
        consent(runtime, computer_use);
    }
    if let Some(replies) = block["replies"].as_array() {
        serve(runtime, replies.clone());
    }
}
