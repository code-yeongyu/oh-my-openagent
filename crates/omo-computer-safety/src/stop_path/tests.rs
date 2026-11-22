//! AC-100: the per-transport default of `StopPolicy{allowHostRelayOnly}`, the relay admitted
//! only under the policy, and the pick-order walk.

use super::{
    GlobalListener, RelayBeat, StopPathFailure, StopPathKind, StopPathView, StopPolicy, Transport,
};

fn view(global: GlobalListener, relay: RelayBeat, allow: bool) -> StopPathView {
    StopPathView {
        global,
        relay,
        policy: StopPolicy {
            allow_host_relay_only: allow,
        },
    }
}

#[test]
fn host_relay_only_policy_per_transport() {
    assert!(!StopPolicy::default_for(Transport::Local).allow_host_relay_only);
    assert!(StopPolicy::default_for(Transport::Relay).allow_host_relay_only);
    assert!(StopPolicy::default_for(Transport::Bunshin).allow_host_relay_only);
    assert!(StopPolicy::read(Transport::Local, Some(true)).allow_host_relay_only);
    assert!(!StopPolicy::read(Transport::Relay, Some(false)).allow_host_relay_only);
    assert_eq!(
        StopPolicy::read(Transport::Bunshin, None),
        StopPolicy::default_for(Transport::Bunshin)
    );

    // (a) no local listener, a fresh relay, the policy on: admitted on the relay.
    assert_eq!(
        view(GlobalListener::None, RelayBeat::Fresh, true).admit(),
        Ok(StopPathKind::HostRelay)
    );
    // (b) the policy off: refused, never admitted.
    assert_eq!(
        view(GlobalListener::None, RelayBeat::Fresh, false).admit(),
        Err(StopPathFailure::HostRelayNotAllowed)
    );
    // (d) relay silence: heartbeat_stale.
    assert_eq!(
        view(GlobalListener::None, RelayBeat::Stale, true).admit(),
        Err(StopPathFailure::HeartbeatStale)
    );
    // (e) a fresh global listener is picked over the relay.
    assert_eq!(
        view(GlobalListener::Fresh, RelayBeat::Fresh, true).admit(),
        Ok(StopPathKind::Global)
    );
    // Nothing fresh to hear.
    assert_eq!(
        view(GlobalListener::None, RelayBeat::Absent, true).admit(),
        Err(StopPathFailure::NoListener)
    );
    assert_eq!(
        view(
            GlobalListener::Stale { since_ms: 0 },
            RelayBeat::Absent,
            true
        )
        .admit(),
        Err(StopPathFailure::HeartbeatStale)
    );

    // The pick-order walk fresh -> stale -> none -> deaf, policy on and off.
    let walk = [
        GlobalListener::Fresh,
        GlobalListener::Stale { since_ms: 10 },
        GlobalListener::None,
        GlobalListener::Deaf { reason: None },
    ];
    let on = walk.map(|global| view(global, RelayBeat::Fresh, true).admit());
    assert_eq!(
        on,
        [
            Ok(StopPathKind::Global),
            Ok(StopPathKind::HostRelay),
            Ok(StopPathKind::HostRelay),
            Err(StopPathFailure::Deaf)
        ]
    );
    let off = walk.map(|global| view(global, RelayBeat::Fresh, false).admit());
    assert_eq!(
        off,
        [
            Ok(StopPathKind::Global),
            Err(StopPathFailure::HostRelayNotAllowed),
            Err(StopPathFailure::HostRelayNotAllowed),
            Err(StopPathFailure::Deaf)
        ]
    );
}

#[test]
fn a_deaf_listener_is_never_answered_by_the_relay() {
    for allow in [true, false] {
        for relay in [RelayBeat::Fresh, RelayBeat::Stale, RelayBeat::Absent] {
            let deaf = view(GlobalListener::Deaf { reason: None }, relay, allow);
            assert_eq!(
                deaf.admit(),
                Err(StopPathFailure::Deaf),
                "relay {relay:?} policy {allow}"
            );
        }
    }
}
