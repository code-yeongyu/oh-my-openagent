//! Row 28's host-latch tests against a scripted host (DESIGN-GAPS-ROW28 revision 2, PROPOSED;
//! R70f: this commit is rewritten if the security read changes the address, trust or outcomes).

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::Path;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::case::{load, repo, Case};
use super::compare::{compare, Context};
use super::host;
use super::peer::Peer;
use super::replay::{replay, replay_case};

const FIXTURES: &str = "crates/omo-computer-engine/tests/common/fixtures/";
const ONESHOT: &str = "marker-deleted-host-latch-set-oneshot-starts-stopped.json";

fn fixture(name: &str) -> String {
    format!("{FIXTURES}{name}")
}

fn oneshot_typing_with_host(block: Value) -> Case {
    let mut case = load(&fixture(ONESHOT));
    case.host = Some(block);
    case
}

#[test]
fn oneshot_starts_suspended_when_the_live_hosts_latch_is_set_even_with_the_marker_deleted() {
    replay(&fixture(ONESHOT)).assert_clean();
}

#[test]
fn rogue_resume_under_a_set_host_latch_relatches_at_session_open() {
    replay(&fixture(
        "rogue-resume-under-set-host-latch-relatches-at-session-open.json",
    ))
    .assert_clean();
}

#[test]
fn host_latch_file_set_and_no_socket_starts_suspended() {
    let case = oneshot_typing_with_host(json!({"latchFile": {"suspended": true, "stopEpoch": 7}}));
    replay_case(&case).assert_clean();
}

// Linux binds an abstract name, which has no path to unlink (the point of the design); the
// unlink attack exists only where the address is a socket file.
#[cfg(not(target_os = "linux"))]
#[test]
fn host_api_socket_unlinked_while_host_latched_starts_suspended() {
    let case = oneshot_typing_with_host(
        json!({"identity": "pass", "latchFile": {"suspended": true, "stopEpoch": 7},
        "replies": [host::status(true, 7)]}),
    );
    let runtime_hook = |runtime: &Path| {
        std::fs::remove_file(runtime.join(host::HOST_API)).expect("the socket is unlinked")
    };
    replay_with_hook(&case, runtime_hook);
}

#[test]
fn host_api_squatter_reply_unlatched_without_identity_starts_suspended() {
    let case =
        oneshot_typing_with_host(json!({"identity": "fail", "replies": [host::status(false, 0)]}));
    replay_case(&case).assert_clean();
}

#[test]
fn foreign_uid_listener_reads_latch_set_not_file_only() {
    let case = oneshot_typing_with_host(
        json!({"identity": "foreign-uid", "replies": [host::status(false, 0)]}),
    );
    replay_case(&case).assert_clean();
}

#[test]
fn host_reply_unlatched_vs_host_latch_file_set_starts_suspended() {
    let case = oneshot_typing_with_host(
        json!({"identity": "pass", "latchFile": {"suspended": true, "stopEpoch": 7},
        "replies": [host::status(false, 6)]}),
    );
    replay_case(&case).assert_clean();
}

#[cfg(unix)]
#[test]
fn runtime_dir_not_owner_only_reads_latch_set() {
    use std::os::unix::fs::PermissionsExt;
    let case =
        oneshot_typing_with_host(json!({"identity": "pass", "replies": [host::status(false, 0)]}));
    replay_with_hook(&case, |runtime| {
        std::fs::set_permissions(runtime, std::fs::Permissions::from_mode(0o775))
            .expect("group-writable runtime dir");
    });
}

#[cfg(unix)]
#[test]
fn host_latch_symlink_is_not_followed_and_reads_latch_set() {
    let case =
        oneshot_typing_with_host(json!({"identity": "pass", "replies": [host::status(false, 0)]}));
    replay_with_hook(&case, |runtime| {
        let unlatched = runtime.join("elsewhere-latch");
        std::fs::write(
            &unlatched,
            json!({"suspended": false, "stopEpoch": 0, "lineHash": "0".repeat(64)}).to_string(),
        )
        .expect("a decoy");
        std::fs::create_dir_all(runtime.join("computer")).expect("the config dir");
        std::os::unix::fs::symlink(&unlatched, runtime.join(host::HOST_LATCH))
            .expect("a symlinked host-latch");
    });
}

fn replay_with_hook(case: &Case, hook: impl Fn(&Path)) {
    let runtime = tempfile::tempdir().expect("a runtime dir");
    host::setup(runtime.path(), case.host.as_ref().expect("a host block"));
    hook(runtime.path());
    let mut bare = case.clone();
    bare.host = None;
    super::replay::replay_case_in(&bare, runtime.path()).assert_clean();
}

fn dial(endpoint: &Path) -> UnixStream {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        match UnixStream::connect(endpoint) {
            Ok(stream) => return stream,
            Err(error) if Instant::now() >= deadline => {
                panic!("the rogue daemon never listened: {error}")
            }
            Err(_) => std::thread::sleep(Duration::from_millis(50)),
        }
    }
}

#[test]
fn rogue_serve_starts_suspended_when_the_live_hosts_latch_is_set() {
    let case = load(&fixture(
        "marker-deleted-host-latch-set-rogue-serve-starts-stopped.json",
    ));
    let runtime = tempfile::tempdir().expect("a runtime dir");
    host::setup(
        runtime.path(),
        case.host.as_ref().expect("the case scripts a host"),
    );
    let scratch = tempfile::tempdir().expect("a scratch dir the host did not choose");
    let endpoint = scratch.path().join("rogue.sock");
    let lock = scratch.path().join("rogue.lock");
    let scenario = repo().join(case.scenario.as_deref().expect("a scenario"));
    let env = vec![
        ("OMO_COMPUTER_BACKEND".to_owned(), "fake".to_owned()),
        (
            "OMO_COMPUTER_RUNTIME_DIR".to_owned(),
            runtime.path().to_string_lossy().into_owned(),
        ),
        (
            "OMO_COMPUTER_FAKE_SCENARIO".to_owned(),
            scenario.to_string_lossy().into_owned(),
        ),
        ("OMO_COMPUTER_FAKE_STOP_PATH".to_owned(), "live".to_owned()),
    ];
    let args = [
        "--enable-daemon",
        "--serve",
        "--endpoint",
        endpoint.to_str().expect("utf-8"),
        "--lock",
        lock.to_str().expect("utf-8"),
    ];
    let daemon = Peer::spawn(&args, &env, &repo());
    let mut stream = dial(&endpoint);
    let mut lines = BufReader::new(stream.try_clone().expect("a reader")).lines();
    let mut failures = Vec::new();
    for step in &case.steps {
        let super::case::Step::Send { send, expect, .. } = step else {
            continue;
        };
        writeln!(stream, "{send}").expect("the daemon reads");
        for expectation in expect {
            let message: Value = lines
                .next()
                .and_then(Result::ok)
                .map_or(json!(null), |line| {
                    serde_json::from_str(&line).unwrap_or(json!(line))
                });
            let mut deltas = Vec::new();
            let mut ctx = Context {
                variable: expectation.variable.iter().map(String::as_str).collect(),
                deltas: &mut deltas,
                failures: Vec::new(),
            };
            compare(&expectation.message, Some(&message), "", &mut ctx);
            failures.extend(ctx.failures);
        }
    }
    drop(stream);
    let _ = daemon.close();
    assert!(
        failures.is_empty(),
        "the rogue --serve was not latched:\n{}",
        failures.join("\n")
    );
}
