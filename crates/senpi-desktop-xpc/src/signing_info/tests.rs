use super::*;
use crate::{
    policy::evaluate,
    roles::{Role, SECURITY_EPOCH, TEAM_IDENTIFIER},
};
use objc2_core_foundation::{CFBoolean, CFMutableDictionary};

fn fixture() -> CFRetained<CFMutableDictionary<CFString, CFType>> {
    let keys = security::info_keys();
    let dict = CFMutableDictionary::empty();
    dict.set(keys.status, CFNumber::new_i64(0x10301).as_ref());
    dict.set(keys.team, CFString::from_str(TEAM_IDENTIFIER).as_ref());
    dict.set(
        keys.identifier,
        CFString::from_str(Role::NativeController.identifier()).as_ref(),
    );
    let plist = CFDictionary::from_slices(
        &[&*CFString::from_str(SECURITY_EPOCH_KEY)],
        &[&*CFString::from_str(SECURITY_EPOCH)],
    );
    dict.set(keys.plist, plist.as_ref());
    dict
}

#[test]
fn resolves_typed_signed_information() {
    // given
    let info = fixture();
    // when
    let peer = resolve(info.as_ref()).and_then(|p| evaluate(p, Role::NativeController));
    // then
    assert_eq!(peer.unwrap().dynamic_status(), 0x10301);
}

#[test]
fn static_flags_never_replace_missing_dynamic_status() {
    // given: even perfect on-disk flags cannot supply the missing live status.
    let info = fixture();
    info.remove(security::info_keys().status);
    info.set(
        &CFString::from_str("flags"),
        CFNumber::new_i64(0x10301).as_ref(),
    );
    // when
    let result = resolve(info.as_ref()).and_then(|p| evaluate(p, Role::NativeController));
    // then
    assert_eq!(result, Err(RejectReason::MissingDynamicStatus));
}

#[test]
fn rejects_mistyped_or_out_of_range_dynamic_status() {
    // given
    let values: Vec<CFRetained<CFType>> = vec![
        CFString::from_str("66305").into(),
        CFNumber::new_f64(66305.0).into(),
        CFNumber::new_i64(-1).into(),
        CFNumber::new_i64(1_i64 << 32).into(),
    ];
    for value in values {
        let info = fixture();
        info.set(security::info_keys().status, &value);
        // when
        let result = resolve(info.as_ref()).and_then(|p| evaluate(p, Role::NativeController));
        // then
        assert_eq!(result, Err(RejectReason::MalformedDynamicStatus));
    }
}

#[test]
fn rejects_boolean_dynamic_status() {
    // given
    let info = fixture();
    info.set(security::info_keys().status, CFBoolean::new(true).as_ref());
    // when
    let result = resolve(info.as_ref()).and_then(|p| evaluate(p, Role::NativeController));
    // then
    assert_eq!(result, Err(RejectReason::MalformedDynamicStatus));
}

#[test]
fn rejects_entitlement_presence_even_when_false() {
    // given
    let info = fixture();
    let entitlements = CFDictionary::<CFString, CFType>::from_slices(
        &[&*CFString::from_str("com.apple.security.get-task-allow")],
        &[CFBoolean::new(false).as_ref()],
    );
    info.set(security::info_keys().entitlements, entitlements.as_ref());
    // when
    let result = resolve(info.as_ref()).and_then(|p| evaluate(p, Role::NativeController));
    // then
    assert_eq!(result, Err(RejectReason::ForbiddenEntitlement));
}

#[test]
fn rejects_non_dictionary_entitlements() {
    // given
    let info = fixture();
    info.set(
        security::info_keys().entitlements,
        CFString::from_str("invalid").as_ref(),
    );
    // when
    let result = resolve(info.as_ref()).and_then(|p| evaluate(p, Role::NativeController));
    // then
    assert_eq!(result, Err(RejectReason::MalformedEntitlements));
}

#[test]
fn rejects_non_string_entitlement_keys() {
    // given
    let info = fixture();
    let entitlements = CFDictionary::<CFType, CFType>::from_slices(
        &[CFNumber::new_i64(1).as_ref()],
        &[CFBoolean::new(false).as_ref()],
    );
    info.set(security::info_keys().entitlements, entitlements.as_ref());
    // when
    let result = resolve(info.as_ref()).and_then(|p| evaluate(p, Role::NativeController));
    // then
    assert_eq!(result, Err(RejectReason::MalformedEntitlements));
}

#[test]
fn rejects_mistyped_signed_epoch() {
    // given
    let info = fixture();
    let plist = CFDictionary::<CFString, CFType>::from_slices(
        &[&*CFString::from_str(SECURITY_EPOCH_KEY)],
        &[CFNumber::new_i64(1).as_ref()],
    );
    info.set(security::info_keys().plist, plist.as_ref());
    // when
    let result = resolve(info.as_ref()).and_then(|p| evaluate(p, Role::NativeController));
    // then
    assert_eq!(result, Err(RejectReason::MalformedSecurityEpoch));
}

#[test]
fn missing_or_mistyped_identity_metadata_is_malformed() {
    // given
    for key in [security::info_keys().team, security::info_keys().identifier] {
        for mistyped in [false, true] {
            let info = fixture();
            info.remove(key);
            if mistyped {
                info.set(key, CFNumber::new_i64(1).as_ref());
            }
            // when
            let result = resolve(info.as_ref()).and_then(|p| evaluate(p, Role::NativeController));
            // then
            assert_eq!(result, Err(RejectReason::MalformedSigningInformation));
        }
    }
}

#[test]
fn real_signing_information_contains_identifier_and_live_valid_status() {
    // given: no injected CF dictionary or requirement outcome.
    let token = crate::audit::AuditToken::current().unwrap();
    let code = security::audit_identity(&token).unwrap();
    // when
    let info = security::signing_information(&code).unwrap();
    let resolved = resolve(&info).unwrap();
    // then
    assert!(matches!(resolved.identifier, Field::Value(id) if !id.is_empty()));
    assert!(matches!(resolved.dynamic_status, Field::Value(bits) if bits & 1 != 0));
}
