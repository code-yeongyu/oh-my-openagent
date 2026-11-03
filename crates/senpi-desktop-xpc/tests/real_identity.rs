#![cfg(target_os = "macos")]

use senpi_desktop_xpc::{
    identity::{AuditToken, SecurityVerifier},
    RejectReason,
};

#[test]
fn real_adapter_rejects_current_ad_hoc_test_process() {
    // given: the kernel token is for this live test binary, not a PID lookup.
    let token = AuditToken::current().expect("kernel must return the current audit token");
    let verifier = SecurityVerifier::from_audit_token(token);
    // when: run real guest resolution, requirement creation and dynamic validity.
    let result = verifier.verify_privileged_client();
    // then: linker/ad-hoc signatures cannot meet the exact Developer ID role.
    assert_eq!(result, Err(RejectReason::RequirementRejected));
}
