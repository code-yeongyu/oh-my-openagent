#![cfg(target_os = "macos")]

#[path = "support/anonymous_xpc.rs"]
mod anonymous_xpc;

use senpi_desktop_xpc::RejectReason;
use std::{sync::mpsc, time::Duration};

#[test]
fn received_xpc_message_resolves_real_sender_and_rejects_ad_hoc_signature() {
    // given: subscribe before creating/activating peers or sending a dictionary.
    let (tx, rx) = mpsc::channel();
    let pair = anonymous_xpc::Pair::new(tx);
    // when
    pair.send_dictionary();
    let verdict = rx
        .recv_timeout(Duration::from_secs(10))
        .expect("the received XPC dictionary must produce a verification verdict");
    // then: proves SecCodeCreateWithXPCMessage succeeded, reaching the exact requirement.
    assert_eq!(verdict, Err(RejectReason::RequirementRejected));
}
