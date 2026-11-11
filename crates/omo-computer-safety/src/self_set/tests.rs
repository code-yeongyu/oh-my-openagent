//! The engine-computed self set: the own chain, every sibling engine's host chain and its TTY
//! owner, and every brain session without an engine, found by its lock file.

use std::fs;

use serde::Deserialize;

use super::{
    read_brain_locks, watch_key, BrainLock, HostAdditions, ProcessInfo, ProcessSnapshot, SelfSet,
    SelfSetInputs, SESSION_LOCK_DIR,
};
use crate::gate::{gate, GateFacts, Identity, PointTarget, Resolution, Tables, Tier, VerbKind};
use crate::protected::{Os, ProtectedTable};
use crate::stop_path::{GlobalListener, RelayBeat, StopPathView, StopPolicy};

fn process(
    pid: u32,
    ppid: u32,
    start: u64,
    name: &str,
    tty: Option<u64>,
    host_pid: Option<u32>,
    leader: bool,
) -> ProcessInfo {
    ProcessInfo {
        pid,
        ppid,
        start,
        name: name.to_owned(),
        tty,
        host_pid,
        session_leader: leader,
    }
}

fn compute(own_pid: u32, snapshot: &ProcessSnapshot, locks: &[BrainLock]) -> SelfSet {
    SelfSet::compute(&SelfSetInputs {
        own_pid,
        snapshot,
        brain_locks: locks,
        brain_names: &[],
        additions: &HostAdditions::default(),
    })
}

#[test]
fn self_set_includes_sibling_engine_host_chain_and_tty() {
    let snapshot = ProcessSnapshot {
        processes: vec![
            process(1, 0, 1, "launchd", None, None, true),
            process(50, 1, 20, "omo-computer-engine", None, None, false),
            process(100, 50, 30, "omo-computer-engine", None, None, false),
            process(200, 1, 40, "omo-computer-engine", None, Some(300), false),
            process(300, 310, 60, "omo", Some(7), None, false),
            process(310, 320, 55, "zsh", Some(7), None, false),
            process(320, 1, 50, "login", Some(7), None, true),
            process(400, 1, 10, "Terminal", None, None, false),
            process(999, 1, 5, "Notes", None, None, false),
        ],
        tty_owners: vec![(7, 400)],
    };
    let set = compute(100, &snapshot, &[]);
    for pid in [100, 50, 1, 200, 300, 310, 320, 400] {
        assert!(set.contains_pid(pid), "{pid} belongs to the self set");
    }
    assert!(!set.contains_pid(999), "an unrelated app is not");
    // A recycled pid: the parent started after the child, so the walk stops at the child.
    let recycled = ProcessSnapshot {
        processes: vec![
            process(100, 77, 30, "omo-computer-engine", None, None, false),
            process(77, 1, 90, "Notes", None, None, false),
        ],
        tty_owners: Vec::new(),
    };
    let set = compute(100, &recycled, &[]);
    assert!(set.contains_pid(100) && !set.contains_pid(77));
    assert!(!set.is_empty(), "the engine-computed set is never empty");
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureProcess {
    pid: u32,
    ppid: u32,
    start: u64,
    name: String,
    tty: Option<u64>,
    host_pid: Option<u32>,
    session_leader: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureTerminal {
    pid: u32,
    app_key: String,
}

#[derive(Deserialize)]
struct FixtureExpect {
    code: String,
    reason: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    engine_pid: u32,
    processes: Vec<FixtureProcess>,
    tty_owners: Vec<(u64, u32)>,
    session_locks: Vec<BrainLock>,
    stale_locks: Vec<BrainLock>,
    terminal: FixtureTerminal,
    expect: FixtureExpect,
}

const FIXTURE: &str =
    include_str!("fixtures/v3-daemon-refuses-brain-only-session-terminal-self-target.json");

fn write_locks(root: &std::path::Path, locks: &[BrainLock]) {
    let dir = root.join(SESSION_LOCK_DIR);
    fs::create_dir_all(&dir).expect("lock dir");
    for lock in locks {
        let body = format!(
            r#"{{"pid":{},"processStart":{}}}"#,
            lock.pid, lock.process_start
        );
        fs::write(dir.join(format!("{}.lock", lock.pid)), body).expect("lock file");
    }
}

#[test]
fn self_set_includes_a_brain_only_session_terminal() {
    let fixture: Fixture = serde_json::from_str(FIXTURE).expect("fixture parses");
    let snapshot = ProcessSnapshot {
        processes: fixture
            .processes
            .into_iter()
            .map(|p| ProcessInfo {
                pid: p.pid,
                ppid: p.ppid,
                start: p.start,
                name: p.name,
                tty: p.tty,
                host_pid: p.host_pid,
                session_leader: p.session_leader,
            })
            .collect(),
        tty_owners: fixture.tty_owners,
    };
    let runtime = tempfile::tempdir().expect("runtime root");
    write_locks(runtime.path(), &fixture.stale_locks);
    fs::write(
        runtime.path().join(SESSION_LOCK_DIR).join("12.lock"),
        "not json",
    )
    .expect("malformed lock");
    let before = read_brain_locks(runtime.path());
    let without = compute(fixture.engine_pid, &snapshot, &before);
    assert!(
        !without.contains_pid(fixture.terminal.pid),
        "a stale or malformed lock names no brain"
    );

    write_locks(runtime.path(), &fixture.session_locks);
    let after = read_brain_locks(runtime.path());
    assert_ne!(
        watch_key(&snapshot, &before),
        watch_key(&snapshot, &after),
        "a lock appearing mid-session is a change"
    );
    let set = compute(fixture.engine_pid, &snapshot, &after);
    assert!(
        set.contains_pid(fixture.terminal.pid),
        "the brain's terminal is in the self set"
    );

    let view = StopPathView {
        global: GlobalListener::Fresh,
        relay: RelayBeat::Absent,
        policy: StopPolicy {
            allow_host_relay_only: false,
        },
    };
    let mut facts = GateFacts::clear(Tier::Exec, VerbKind::Keyboard, view);
    facts.force = true;
    let tables = Tables {
        self_set: &set,
        protected: ProtectedTable::of(Os::host()),
        allowed_apps: &[],
    };
    let target = Identity {
        pid: fixture.terminal.pid,
        app_key: fixture.terminal.app_key,
        surface: None,
    };
    let refused = gate(&facts, &tables, || {
        vec![PointTarget::new(None, Resolution::Window(target))]
    })
    .expect_err("SelfTarget");
    assert_eq!(refused.refusal.code.wire(), fixture.expect.code);
    assert_eq!(refused.refusal.reason, Some(fixture.expect.reason.as_str()));
    assert!(refused.nothing_sent());
}
