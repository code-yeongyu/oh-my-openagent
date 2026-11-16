//! Bounded libei reconnect, per route (d-linux.md 'Connection lifecycle'; acceptance 25).

use std::time::{Duration, Instant};

use omo_computer_core::capabilities::CompositorName;
use omo_computer_core::error::{EngineCode, Reason};

use super::support::{key, send, Rig, SETTLE, US};
use crate::fake::Mode;
use crate::input::RECONNECT_BACKOFF_MS;

/// The longest a reconnect may take: every backoff step plus one handshake's slack.
fn bound() -> Duration {
    Duration::from_millis(RECONNECT_BACKOFF_MS.iter().sum::<u64>() + 1_000)
}

#[test]
fn libei_reconnects_within_bound_after_transient_failure() {
    let rig = Rig::new(US, Mode::DropOnce);
    let mut backend = rig.socket_backend(CompositorName::Mutter);
    assert!(backend.connect_input().is_ok(), "the first connection completes its handshake");
    assert!(rig.eis.wait_for(SETTLE, |log| log.dropped == 1), "the fake dropped the client once");
    let started = Instant::now();
    let sent = send(&mut backend, &key("a", true)).and_then(|_| send(&mut backend, &key("a", false)));
    let took = started.elapsed();
    assert!(sent.is_ok(), "the key goes out on the new connection: {sent:?}");
    assert!(took <= bound(), "reconnected within the bound: {took:?} > {:?}", bound());
    let log = rig.eis.log();
    assert_eq!(log.connections, 2, "exactly one reconnect: {log:?}");
    assert_eq!(log.keys.iter().filter(|(_, down)| *down).count(), 1, "one key press reached the fake after the reconnect");
    assert_eq!(backend.input_report().reconnects, 1);
    assert!(backend.input_report().ready, "the device reads ready again");
}

#[test]
fn libei_reconnect_on_portal_route() {
    // The live session accepts a second ConnectToEIS: the engine reconnects on it, no dialog.
    let rig = Rig::new(US, Mode::DropOnce);
    let portal = rig.portal().accepting_second_connect(true);
    let mut backend = rig.portal_backend(CompositorName::Mutter, &portal);
    assert!(send(&mut backend, &key("a", true)).and_then(|_| send(&mut backend, &key("a", false))).is_ok() || rig.eis.log().dropped == 1);
    assert!(rig.eis.wait_for(SETTLE, |log| log.dropped == 1));
    assert!(send(&mut backend, &key("b", true)).and_then(|_| send(&mut backend, &key("b", false))).is_ok(), "re-connected on the live session");
    let seen = portal.log();
    assert_eq!(seen.dialogs, 1, "a reconnect never raises the consent dialog");
    assert_eq!(seen.connects, 2, "a second ConnectToEIS on the same session");

    // The portal refuses the second ConnectToEIS (SP-W measured that on GNOME and KDE) and no
    // token is persisted: the session is lost, the call answers libei_lost, nothing is sent.
    let rig = Rig::new(US, Mode::DropOnce);
    let portal = rig.portal().accepting_second_connect(false);
    let mut backend = rig.portal_backend(CompositorName::Mutter, &portal);
    let _first = send(&mut backend, &key("a", true)).and_then(|_| send(&mut backend, &key("a", false)));
    assert!(rig.eis.wait_for(SETTLE, |log| log.dropped == 1));
    let keys_before = rig.eis.log().keys.len();
    let refusal = send(&mut backend, &key("b", true)).expect_err("the lost session refuses");
    assert_eq!(refusal.code, EngineCode::Internal);
    assert_eq!(refusal.reason, Some(Reason::LibeiLost));
    assert_eq!(refusal.wire_data()["nextCall"], "capabilities()");
    assert_eq!(rig.eis.log().keys.len(), keys_before, "nothing sent");
    assert_eq!(portal.log().dialogs, 1, "no dialog inside an input call");

    // The portal's Closed signal arrived: no ConnectToEIS is tried at all.
    let rig = Rig::new(US, Mode::DropOnce);
    let portal = rig.portal().accepting_second_connect(true);
    let mut backend = rig.portal_backend(CompositorName::Mutter, &portal);
    let _first = send(&mut backend, &key("a", true)).and_then(|_| send(&mut backend, &key("a", false)));
    assert!(rig.eis.wait_for(SETTLE, |log| log.dropped == 1));
    portal.close_session();
    let connects = portal.log().connects;
    let refusal = send(&mut backend, &key("b", true)).expect_err("a closed session refuses");
    assert_eq!(refusal.reason, Some(Reason::LibeiLost));
    assert_eq!(portal.log().connects, connects, "no ConnectToEIS on a closed session");
    assert_eq!(portal.log().dialogs, 1);
}
