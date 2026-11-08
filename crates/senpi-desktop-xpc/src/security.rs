//! Minimal public Security.framework ABI, matching the macOS SDK SecCode.h.
use crate::{
    audit::AuditToken, identity::XpcMessage, roles::Role, RejectReason, SecurityOperation,
};
use objc2_core_foundation::{CFData, CFDictionary, CFRetained, CFString, CFType};
use std::{ffi::c_void, ptr::NonNull};

#[link(name = "Security", kind = "framework")]
unsafe extern "C" {
    fn SecCodeCreateWithXPCMessage(message: *mut c_void, flags: u32, code: *mut *mut CFType)
        -> i32;
    fn SecCodeCopyGuestWithAttributes(
        host: *const CFType,
        attributes: *const CFDictionary,
        flags: u32,
        code: *mut *mut CFType,
    ) -> i32;
    fn SecRequirementCreateWithString(
        text: *const CFString,
        flags: u32,
        requirement: *mut *mut CFType,
    ) -> i32;
    fn SecCodeCheckValidity(code: *const CFType, flags: u32, requirement: *const CFType) -> i32;
    fn SecCodeCopySigningInformation(
        code: *const CFType,
        flags: u32,
        info: *mut *mut CFType,
    ) -> i32;
    static kSecGuestAttributeAudit: &'static CFString;
    static kSecCodeInfoStatus: &'static CFString;
    static kSecCodeInfoEntitlementsDict: &'static CFString;
    static kSecCodeInfoPList: &'static CFString;
    static kSecCodeInfoTeamIdentifier: &'static CFString;
    static kSecCodeInfoIdentifier: &'static CFString;
}

// Only the Security Create/Copy calls below supply this closure. Their outputs
// obey the CF Create rule and are unchanged (null) on failure.
fn created(
    operation: SecurityOperation,
    call: impl FnOnce(*mut *mut CFType) -> i32,
) -> Result<CFRetained<CFType>, RejectReason> {
    let mut output = std::ptr::null_mut();
    let status = call(&mut output);
    if status != 0 {
        return Err(RejectReason::SecurityFramework { operation, status });
    }
    let output = NonNull::new(output).ok_or(RejectReason::MissingSecurityObject)?;
    // SAFETY: a successful Security Create/Copy returns a live +1 CF object;
    // NonNull rejected null. CFRetained owns exactly that reference.
    Ok(unsafe { CFRetained::from_raw(output) })
}

pub(crate) fn message_identity(
    message: &XpcMessage<'_>,
) -> Result<CFRetained<CFType>, RejectReason> {
    created(SecurityOperation::MessageIdentity, |output| {
        // SAFETY: XpcMessage's constructor guarantees a live received object;
        // created supplies a writable output. The API uses its audit token.
        unsafe { SecCodeCreateWithXPCMessage(message.pointer.as_ptr(), 0, output) }
    })
}

pub(crate) fn audit_identity(token: &AuditToken) -> Result<CFRetained<CFType>, RejectReason> {
    let data = CFData::from_bytes(&token.bytes());
    // SAFETY: Security exports this immutable, nonnull CFString constant.
    let key = unsafe { kSecGuestAttributeAudit };
    let attributes = CFDictionary::from_slices(&[key], &[&*data]);
    created(SecurityOperation::AuditIdentity, |output| {
        // SAFETY: attributes owns a CFData containing exactly audit_token_t's
        // 32 native-endian bytes. Null host selects the kernel; output is live.
        unsafe { SecCodeCopyGuestWithAttributes(std::ptr::null(), attributes.as_ref(), 0, output) }
    })
}

pub(crate) fn check_requirement(code: &CFType, role: Role) -> Result<(), RejectReason> {
    let text = CFString::from_str(&role.requirement());
    let requirement = created(SecurityOperation::RequirementCreation, |output| {
        // SAFETY: text remains alive and output is a valid writable CF out-pointer.
        unsafe { SecRequirementCreateWithString(&*text, 0, output) }
    })?;
    // SAFETY: code is a retained SecCode from one of the resolution APIs;
    // requirement is a retained SecRequirement from the creation API.
    let status = unsafe { SecCodeCheckValidity(code, 0, &*requirement) };
    requirement_result(status)
}

fn requirement_result(status: i32) -> Result<(), RejectReason> {
    match status {
        0 => Ok(()),
        -67050 => Err(RejectReason::RequirementRejected), // errSecCSReqFailed
        status => Err(RejectReason::SecurityFramework {
            operation: SecurityOperation::RequirementCheck,
            status,
        }),
    }
}

pub(crate) fn signing_information(code: &CFType) -> Result<CFRetained<CFType>, RejectReason> {
    created(SecurityOperation::SigningInformation, |output| {
        // SAFETY: code is a live SecCode and output is writable. SDK flags
        // kSecCSSigningInformation (1<<1) | kSecCSDynamicInformation (1<<3)
        // request live status, not the on-disk kSecCodeInfoFlags.
        unsafe { SecCodeCopySigningInformation(code, (1 << 1) | (1 << 3), output) }
    })
}

pub(crate) struct InfoKeys {
    pub status: &'static CFString,
    pub entitlements: &'static CFString,
    pub plist: &'static CFString,
    pub team: &'static CFString,
    pub identifier: &'static CFString,
}

pub(crate) fn info_keys() -> InfoKeys {
    // SAFETY: these are immutable nonnull CFString constants exported by
    // Security.framework, valid throughout the process lifetime.
    unsafe {
        InfoKeys {
            status: kSecCodeInfoStatus,
            entitlements: kSecCodeInfoEntitlementsDict,
            plist: kSecCodeInfoPList,
            team: kSecCodeInfoTeamIdentifier,
            identifier: kSecCodeInfoIdentifier,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_framework_calls_never_create_security_objects() {
        // given
        for operation in [
            SecurityOperation::MessageIdentity,
            SecurityOperation::AuditIdentity,
            SecurityOperation::RequirementCreation,
            SecurityOperation::SigningInformation,
        ] {
            // when
            let result = created(operation, |_| -50);
            // then
            assert!(matches!(result, Err(RejectReason::SecurityFramework {
                operation: actual, status: -50
            }) if actual == operation));
        }
    }

    #[test]
    fn successful_status_with_null_output_fails_closed() {
        // given
        let operation = SecurityOperation::MessageIdentity;
        // when
        let result = created(operation, |_| 0);
        // then
        assert!(matches!(result, Err(RejectReason::MissingSecurityObject)));
    }

    #[test]
    fn only_requirement_mismatch_is_reported_as_requirement_rejected() {
        // given: errSecCSReqFailed, a parameter error, and a validity error.
        for status in [-67050, -50, -67061] {
            // when
            let result = requirement_result(status);
            // then
            if status == -67050 {
                assert_eq!(result, Err(RejectReason::RequirementRejected));
            } else {
                assert!(matches!(result,
                    Err(RejectReason::SecurityFramework {
                        operation: SecurityOperation::RequirementCheck, status: actual
                    }) if actual == status));
            }
        }
    }
}
