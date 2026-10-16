//! The transport boundary owns authentication ordering and session replay state.
use crate::connection::{Envelope, SessionGate, TransportError};
use crate::listener::prepare_listener;
use crate::policy::{evaluate, tests::eligible};
use crate::roles::Role;
use crate::RejectReason;
use std::cell::{Cell, RefCell};
use std::time::{Duration, Instant};

fn peer() -> crate::VerifiedPeer {
    evaluate(eligible(Role::NativeController), Role::NativeController).unwrap()
}

#[test]
fn requirement_failure_prevents_listener_resume() {
    // given
    let calls = RefCell::new(Vec::new());
    // when
    let result = prepare_listener(
        || {
            calls.borrow_mut().push("requirement");
            22
        },
        || calls.borrow_mut().push("handler"),
        || calls.borrow_mut().push("resume"),
    );
    // then
    assert_eq!(result, Err(TransportError::Requirement(22)));
    assert!(!calls.borrow().contains(&"resume"));
}

#[test]
fn handler_and_requirement_are_installed_before_resume() {
    // given
    let calls = RefCell::new(Vec::new());
    // when
    prepare_listener(
        || {
            calls.borrow_mut().push("requirement");
            0
        },
        || calls.borrow_mut().push("handler"),
        || calls.borrow_mut().push("resume"),
    )
    .unwrap();
    // then
    assert_eq!(*calls.borrow(), ["requirement", "handler", "resume"]);
}

#[test]
fn unauthenticated_dictionary_is_never_decoded_or_dispatched() {
    // given
    let decoded = Cell::new(false);
    let mut gate = SessionGate::new([7; 32]);
    // when
    let result = gate.receive(
        Err(RejectReason::RequirementRejected),
        || {
            decoded.set(true);
            Err(TransportError::Dictionary)
        },
        Instant::now(),
    );
    // then
    assert_eq!(
        result,
        Err(TransportError::Identity(RejectReason::RequirementRejected))
    );
    assert!(!decoded.get());
    assert!(gate.is_closed());
}

#[test]
fn malformed_dictionary_closes_authenticated_connection() {
    // given
    let mut gate = SessionGate::new([7; 32]);
    // when
    let result = gate.receive(
        Ok(peer()),
        || Err(TransportError::Dictionary),
        Instant::now(),
    );
    // then
    assert_eq!(result, Err(TransportError::Dictionary));
    assert!(gate.is_closed());
}

fn approved_gate(now: Instant, capability: [u8; 32]) -> SessionGate {
    let mut gate = SessionGate::new(capability);
    gate.receive(Ok(peer()), || Ok(Envelope::Challenge([9; 32])), now)
        .unwrap();
    gate.receive(
        Ok(peer()),
        || {
            Ok(Envelope::Approve {
                hashes: vec![SessionGate::digest(
                    br#"{"jsonrpc":"2.0","id":1,"method":"session.open"}"#,
                )],
                lifetime: Duration::from_secs(10),
            })
        },
        now,
    )
    .unwrap();
    gate
}

fn frame(capability: [u8; 32], sequence: u64) -> Envelope {
    Envelope::Frame {
        capability,
        sequence,
        payload: br#"{"jsonrpc":"2.0","id":1,"method":"session.open"}"#.to_vec(),
    }
}

#[test]
fn authenticated_frame_without_approval_never_reaches_dispatch() {
    // given
    let now = Instant::now();
    let mut gate = SessionGate::new([7; 32]);
    gate.receive(Ok(peer()), || Ok(Envelope::Challenge([9; 32])), now)
        .unwrap();
    // when
    let result = gate.receive(Ok(peer()), || Ok(frame([7; 32], 1)), now);
    // then
    assert_eq!(result, Err(TransportError::Approval));
    assert!(gate.is_closed());
}

#[test]
fn stale_capability_is_rejected() {
    // given
    let now = Instant::now();
    let mut gate = approved_gate(now, [7; 32]);
    // when
    let result = gate.receive(Ok(peer()), || Ok(frame([8; 32], 1)), now);
    // then
    assert_eq!(result, Err(TransportError::Capability));
}

#[test]
fn capability_from_another_live_connection_is_rejected() {
    // given
    let now = Instant::now();
    let _first = approved_gate(now, [1; 32]);
    let mut second = approved_gate(now, [2; 32]);
    // when
    let result = second.receive(Ok(peer()), || Ok(frame([1; 32], 1)), now);
    // then
    assert_eq!(result, Err(TransportError::Capability));
}

#[test]
fn replayed_sequence_is_rejected_without_dispatch() {
    // given
    let now = Instant::now();
    let mut gate = approved_gate(now, [7; 32]);
    gate.receive(Ok(peer()), || Ok(frame([7; 32], 1)), now)
        .unwrap();
    // when
    let result = gate.receive(Ok(peer()), || Ok(frame([7; 32], 1)), now);
    // then
    assert_eq!(result, Err(TransportError::Sequence));
}

#[test]
fn expired_approval_is_rejected_without_dispatch() {
    // given
    let now = Instant::now();
    let mut gate = approved_gate(now, [7; 32]);
    // when
    let result = gate.receive(
        Ok(peer()),
        || Ok(frame([7; 32], 1)),
        now + Duration::from_secs(11),
    );
    // then
    assert_eq!(result, Err(TransportError::Approval));
}

#[test]
fn altered_frame_does_not_redeem_an_approved_hash() {
    // given
    let now = Instant::now();
    let mut gate = approved_gate(now, [7; 32]);
    // when
    let result = gate.receive(
        Ok(peer()),
        || {
            Ok(Envelope::Frame {
                capability: [7; 32],
                sequence: 1,
                payload: br#"{"jsonrpc":"2.0","id":1,"method":"capture"}"#.to_vec(),
            })
        },
        now,
    );
    // then
    assert_eq!(result, Err(TransportError::Approval));
}

#[test]
fn interruption_invalidates_capability_and_pending_approval() {
    // given
    let now = Instant::now();
    let mut gate = approved_gate(now, [7; 32]);
    gate.close();
    // when
    let result = gate.receive(Ok(peer()), || Ok(frame([7; 32], 1)), now);
    // then
    assert_eq!(result, Err(TransportError::Closed));
}
