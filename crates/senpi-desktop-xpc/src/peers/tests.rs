use super::*;
use crate::native::{xpc_connection_create, Object};

fn inactive_peer() -> Arc<Peer> {
    // SAFETY: valid NUL-terminated name and default dispatch queue.
    let raw = unsafe {
        xpc_connection_create(
            c"ai.sisyphuslabs.test.unbound".as_ptr(),
            std::ptr::null_mut(),
        )
    };
    // SAFETY: creation transfers one reference, kept through Peer::accept.
    let original = unsafe { Object::owned(raw) }.unwrap();
    // SAFETY: original holds the live connection while accept retains it.
    let peer = unsafe { Peer::accept(original.raw()) }.unwrap();
    Arc::new(peer)
}

#[test]
fn r2_m1_capacity_rejection_activates_before_cancellation_and_release() {
    // given: exercise the real capacity branch, after its separate EUID check.
    let peers = Peers::default();
    let occupied = inactive_peer();
    occupied.install(|_| {});
    for id in 0..128 {
        peers.state.lock().peers.insert(id, Arc::clone(&occupied));
    }
    let candidate = inactive_peer();
    // when
    let result = peers.insert(Arc::clone(&candidate));
    let activated = candidate.was_activated();
    // Keep baseline teardown legal even when the regression assertion fails.
    if !activated {
        candidate.install(|_| {});
    }
    // then
    assert!(matches!(result, Err(TransportError::Capacity)));
    assert!(activated, "capacity rejection left a native peer inactive");
}
