//! Held input on engine death, and the two degraded states SP-W's release row decides
//! (d-linux.md 'Emulation', RELEASE ON ENGINE DEATH; fixtures under `fixtures/`).

use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use omo_computer_core::backend::Backend;
use omo_computer_core::capabilities::{BackgroundReach, CompositorName, ReleaseHelperReason};
use omo_computer_core::error::{EngineCode, Reason};
use serde_json::Value;

use super::support::{key, send, Rig, SETTLE, US};
use crate::fake::Mode;
use crate::ledger::Ledger;
use crate::release::VerbKind;
use crate::{InputRoute, WaylandBackend};

const KEY_LEFTSHIFT: u32 = 42;
const CHILD_SOCKET: &str = "OMO_WAYLAND_TEST_EIS_SOCKET";

/// The child half of the SIGKILL leg: holds shift through libei, says so, and waits to die.
#[test]
#[ignore = "run only as the child of held_input_released_on_sigkill_wayland_leg"]
fn sigkill_child_holds_shift() {
    let Some(socket) = std::env::var_os(CHILD_SOCKET) else { return };
    let dir = tempfile::tempdir().expect("temp dir");
    let mut backend = WaylandBackend::new(super::support::options(CompositorName::Mutter, InputRoute::Socket(socket.into()), dir.path().join("c.json")));
    send(&mut backend, &key("shift", true)).expect("shift goes down");
    println!("HELD");
    std::thread::sleep(Duration::from_secs(60));
}

#[test]
fn held_input_released_on_sigkill_wayland_leg() {
    let rig = Rig::new(US, Mode::SecondClientRefused);
    let mut child = Command::new(std::env::current_exe().expect("test binary"))
        .args(["--exact", "tests::release::sigkill_child_holds_shift", "--ignored", "--nocapture", "--test-threads=1"])
        .env(CHILD_SOCKET, rig.eis.socket())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("child engine starts");
    let stdout = child.stdout.take().expect("child stdout");
    let held = BufReader::new(stdout).lines().map_while(Result::ok).any(|line| line.trim() == "HELD");
    assert!(held, "the child reported shift held");
    assert!(rig.eis.wait_for(SETTLE, |log| log.held == vec![KEY_LEFTSHIFT]), "the fake's seat holds shift: {:?}", rig.eis.log());

    let killed = Instant::now();
    child.kill().expect("SIGKILL");
    child.wait().expect("reaped");
    assert!(rig.eis.wait_for(Duration::from_secs(2), |log| log.released_at.is_some()), "released within 2 s of the kill");
    let log = rig.eis.log();
    let closed = log.closed_at.expect("the socket closed");
    let released = log.released_at.expect("released");
    assert!(closed.duration_since(killed) <= Duration::from_secs(2), "SIGKILL closed the engine's only EIS socket");
    assert!(released.duration_since(closed) <= Duration::from_secs(2), "released within 2 s of the socket close");
    assert!(log.held.is_empty());
    assert_eq!(log.connections, 1, "the engine's one connection");
    assert_eq!(log.refused, 0, "ZERO helper EIS connections: no second client was even attempted");
}

/// One fixture step: the verb's kind, the keys it sends, and what must happen.
fn run_fixture(name: &str, ledger: Ledger, compositor: CompositorName) -> (Value, WaylandBackend, Rig) {
    let path = format!("{}/fixtures/{name}.json", env!("CARGO_MANIFEST_DIR"));
    let fixture: Value = serde_json::from_str(&std::fs::read_to_string(&path).expect("fixture")).expect("fixture json");
    let rig = Rig::new(US, Mode::Serve);
    let mut options = super::support::options(compositor, InputRoute::Socket(rig.eis.socket().to_owned()), rig.state_file());
    options.ledger = ledger;
    let mut backend = WaylandBackend::new(options);
    for step in fixture["steps"].as_array().expect("steps") {
        let verb = VerbKind::from_wire(step["kind"].as_str().expect("kind")).expect("known kind");
        let frames_before = rig.eis.log().keys.len();
        let outcome = backend.admit(verb).and_then(|()| {
            for pair in step["keys"].as_array().into_iter().flatten() {
                send(&mut backend, &key(pair[0].as_str().expect("key"), pair[1].as_bool().expect("down")))?;
            }
            Ok(())
        });
        let expect = &step["expect"];
        if let Some(refused) = expect.get("refused") {
            let refusal = outcome.expect_err(step["verb"].as_str().unwrap_or("step"));
            assert_eq!(refusal.code, EngineCode::StopPathUnavailable);
            assert_eq!(refusal.reason.map(Reason::wire), refused["reason"].as_str());
            if let Some(next) = refused.get("nextCall") {
                assert_eq!(&refusal.wire_data()["nextCall"], next, "{}", step["verb"]);
            }
            assert_eq!(rig.eis.log().keys.len(), frames_before, "{}: zero libei frames", step["verb"]);
        } else {
            assert!(outcome.is_ok(), "{} delivered: {outcome:?}", step["verb"]);
            if let Some(keys) = step["keys"].as_array() {
                assert!(rig.eis.wait_for(SETTLE, |log| log.keys.len() == frames_before + keys.len()), "{} reached the fake", step["verb"]);
            }
        }
    }
    (fixture, backend, rig)
}

#[test]
fn wayland_hold_refused_release_unproven() {
    // weston has no SP-W row: the release is unproven.
    let (fixture, backend, _rig) = run_fixture("wayland-hold-refused-release-unproven", Ledger::shipped(), CompositorName::Weston);
    let helper = backend.capabilities().release_helper.expect("releaseHelper is reported on Wayland");
    assert!(!helper.available);
    assert_eq!(helper.reason, Some(ReleaseHelperReason::WaylandReleaseUnproven));
    assert_eq!(fixture["capabilities"]["releaseHelper"]["reason"], "wayland_release_unproven");
}

#[test]
fn wayland_release_contradicts_refuses_held_verbs_and_reads_ax_only() {
    // A fake SP-W row: GNOME measured NO release on socket close.
    let ledger = Ledger::shipped().with_release_verdict(CompositorName::Mutter, crate::ledger::ReleaseProof::Contradicts);
    let (_fixture, backend, _rig) = run_fixture("wayland-release-contradicts-refuses-held-verbs", ledger, CompositorName::Mutter);
    let caps = backend.capabilities();
    assert_eq!(caps.background_reach, BackgroundReach::AxOnly, "a fanout filters before dialing");
    assert_eq!(caps.release_helper.map(|helper| helper.available), Some(false));
    assert!(backend.admit(VerbKind::AxAction).is_ok(), "el.click / el.perform / setValue hold nothing");
    assert!(backend.admit(VerbKind::Read).is_ok());
}
