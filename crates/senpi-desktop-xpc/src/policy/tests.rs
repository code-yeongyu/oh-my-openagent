use super::*;
use crate::roles::{SECURITY_EPOCH, TEAM_IDENTIFIER};

pub(crate) fn eligible(role: Role) -> ResolvedPeer {
    ResolvedPeer {
        requirement: Ok(()),
        dynamic_status: Field::Value(CS_VALID | CS_RUNTIME | CS_HARD | CS_KILL),
        entitlements: Ok(None),
        security_epoch: Field::Value(SECURITY_EPOCH.into()),
        team: Field::Value(TEAM_IDENTIFIER.into()),
        identifier: Field::Value(role.identifier().into()),
    }
}

#[test]
fn accepts_only_complete_role_eligibility() {
    // given
    for role in [Role::NativeController, Role::EngineServer] {
        let peer = eligible(role);
        // when
        let verified = evaluate(peer, role).unwrap();
        // then
        assert_eq!(verified.role(), role);
        assert_eq!(verified.identifier(), role.identifier());
        assert_eq!(verified.team(), TEAM_IDENTIFIER);
        assert_eq!(verified.security_epoch(), SECURITY_EPOCH);
        assert_eq!(verified.dynamic_status(), 0x10301);
    }
}

macro_rules! rejects {
    ($name:ident, $change:expr, $reason:expr) => {
        #[test]
        fn $name() {
            // given
            let mut peer = eligible(Role::NativeController);
            ($change)(&mut peer);
            // when
            let result = evaluate(peer, Role::NativeController);
            // then
            assert_eq!(result, Err($reason));
        }
    };
}

rejects!(
    missing_runtime,
    |p: &mut ResolvedPeer| p.dynamic_status = Field::Value(0x301),
    RejectReason::MissingHardening
);
rejects!(
    missing_hard,
    |p: &mut ResolvedPeer| p.dynamic_status = Field::Value(0x10201),
    RejectReason::MissingHardening
);
rejects!(
    missing_kill,
    |p: &mut ResolvedPeer| p.dynamic_status = Field::Value(0x10101),
    RejectReason::MissingHardening
);
rejects!(
    missing_valid,
    |p: &mut ResolvedPeer| p.dynamic_status = Field::Value(0x10300),
    RejectReason::InvalidSignature
);
rejects!(
    debugged,
    |p: &mut ResolvedPeer| p.dynamic_status = Field::Value(0x10010301),
    RejectReason::Debugged
);
rejects!(
    missing_dynamic_status,
    |p: &mut ResolvedPeer| p.dynamic_status = Field::Missing,
    RejectReason::MissingDynamicStatus
);
rejects!(
    malformed_dynamic_status,
    |p: &mut ResolvedPeer| p.dynamic_status = Field::Malformed,
    RejectReason::MalformedDynamicStatus
);
rejects!(
    missing_epoch,
    |p: &mut ResolvedPeer| p.security_epoch = Field::Missing,
    RejectReason::MissingSecurityEpoch
);
rejects!(
    malformed_epoch,
    |p: &mut ResolvedPeer| p.security_epoch = Field::Malformed,
    RejectReason::MalformedSecurityEpoch
);
rejects!(
    stale_epoch,
    |p: &mut ResolvedPeer| p.security_epoch = Field::Value("xpc-0".into()),
    RejectReason::StaleSecurityEpoch
);
rejects!(
    wrong_team,
    |p: &mut ResolvedPeer| p.team = Field::Value("OTHERTEAM".into()),
    RejectReason::WrongTeam
);
rejects!(
    unknown_role,
    |p: &mut ResolvedPeer| p.identifier = Field::Value("unknown".into()),
    RejectReason::UnknownRole
);
rejects!(
    invalid_requirement,
    |p: &mut ResolvedPeer| p.requirement = Err(RejectReason::RequirementRejected),
    RejectReason::RequirementRejected
);
rejects!(
    malformed_entitlements,
    |p: &mut ResolvedPeer| p.entitlements = Err(RejectReason::MalformedEntitlements),
    RejectReason::MalformedEntitlements
);

#[test]
fn rejects_forbidden_entitlement_presence() {
    // given: presence is forbidden regardless of its value, including false.
    for name in [
        "com.apple.security.cs.disable-library-validation",
        "com.apple.security.cs.allow-dyld-environment-variables",
        "com.apple.security.get-task-allow",
        "com.apple.security.cs.allow-jit",
        "com.apple.security.cs.allow-unsigned-executable-memory",
        "com.apple.security.cs.disable-executable-page-protection",
    ] {
        let mut peer = eligible(Role::NativeController);
        peer.entitlements = Ok(Some(vec![name.into()]));
        // when
        let result = evaluate(peer, Role::NativeController);
        // then
        assert_eq!(result, Err(RejectReason::ForbiddenEntitlement), "{name}");
    }
}

#[test]
fn rejects_all_non_controller_clients() {
    // given: even correctly hardened same-team artifacts cannot gain a role.
    for identifier in [
        "com.omo.desktop",
        "com.mengmota.omo-desktop-runtime",
        "node",
        "org.nodejs.node",
        "bun",
        "com.oven.bun",
        "bunshin",
        "ai.sisyphuslabs.bunshin",
        "ai.sisyphuslabs.senpi-desktop-engine",
        Role::EngineServer.identifier(),
    ] {
        let mut peer = eligible(Role::NativeController);
        peer.identifier = Field::Value(identifier.into());
        // when
        let result = evaluate(peer, Role::NativeController);
        // then
        let reason = if identifier == Role::EngineServer.identifier() {
            RejectReason::RoleMismatch
        } else {
            RejectReason::UnknownRole
        };
        assert_eq!(result, Err(reason), "{identifier}");
    }
}

#[test]
fn propagates_every_security_framework_failure() {
    // given
    for operation in [
        SecurityOperation::MessageIdentity,
        SecurityOperation::AuditIdentity,
        SecurityOperation::RequirementCreation,
        SecurityOperation::RequirementCheck,
        SecurityOperation::SigningInformation,
        SecurityOperation::SelfAuditToken,
    ] {
        let mut peer = eligible(Role::NativeController);
        let reason = RejectReason::SecurityFramework {
            operation,
            status: -50,
        };
        peer.requirement = Err(reason);
        // when
        let result = evaluate(peer, Role::NativeController);
        // then
        assert_eq!(result, Err(reason));
    }
}

#[test]
fn accepts_empty_and_benign_entitlements() {
    // given
    for names in [vec![], vec!["com.apple.security.app-sandbox".into()]] {
        let mut peer = eligible(Role::NativeController);
        peer.entitlements = Ok(Some(names));
        // when
        let result = evaluate(peer, Role::NativeController);
        // then
        assert!(result.is_ok());
    }
}
