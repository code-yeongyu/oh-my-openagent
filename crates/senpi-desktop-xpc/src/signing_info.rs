//! Decode only Security.framework-owned CF objects, never an on-disk plist.
use crate::{
    policy::{Field, ResolvedPeer},
    roles::SECURITY_EPOCH_KEY,
    security, RejectReason,
};
use objc2_core_foundation::{
    CFDictionary, CFNumber, CFPropertyListFormat, CFPropertyListIsValid, CFRetained, CFString,
    CFType,
};

type Dictionary = CFDictionary<CFType, CFType>;

fn dictionary(value: &CFType) -> Result<&Dictionary, RejectReason> {
    let dict = value
        .downcast_ref::<CFDictionary>()
        .ok_or(RejectReason::MalformedSigningInformation)?;
    // SAFETY: Security's dictionaries and property lists contain CF objects.
    // The outer dictionary type was checked; individual keys/values are still
    // CFType and must be downcast before use.
    Ok(unsafe { &*(std::ptr::from_ref(dict).cast::<Dictionary>()) })
}

fn get(dict: &Dictionary, key: &CFString) -> Option<CFRetained<CFType>> {
    dict.get(key.as_ref())
}

fn string(value: Option<CFRetained<CFType>>) -> Field<String> {
    match value {
        None => Field::Missing,
        Some(value) => match value.downcast_ref::<CFString>() {
            Some(text) => Field::Value(text.to_string()),
            None => Field::Malformed,
        },
    }
}

fn status(value: Option<CFRetained<CFType>>) -> Field<u32> {
    let value = match value {
        Some(value) => value,
        None => return Field::Missing,
    };
    let number = match value.downcast_ref::<CFNumber>() {
        Some(number) if !number.is_float_type() => number,
        _ => return Field::Malformed,
    };
    match number.as_i64().and_then(|n| u32::try_from(n).ok()) {
        Some(bits) => Field::Value(bits),
        None => Field::Malformed,
    }
}

fn entitlements(value: Option<CFRetained<CFType>>) -> Result<Option<Vec<String>>, RejectReason> {
    let value = match value {
        Some(value) => value,
        None => return Ok(None),
    };
    let dict = dictionary(&value).map_err(|_| RejectReason::MalformedEntitlements)?;
    // SAFETY: the outer type was checked as a dictionary of CF objects.
    // CFPropertyListIsValid checks all nested values and string keys; no
    // downcast of an unchecked nested value occurs here.
    let valid = unsafe { CFPropertyListIsValid(&value, CFPropertyListFormat::BinaryFormat_v1_0) };
    if !valid {
        return Err(RejectReason::MalformedEntitlements);
    }
    let (keys, _) = dict.to_vecs();
    let names: Result<Vec<_>, _> = keys
        .iter()
        .map(|key| {
            key.downcast_ref::<CFString>()
                .map(|s| s.to_string())
                .ok_or(RejectReason::MalformedEntitlements)
        })
        .collect();
    names.map(Some)
}

pub(crate) fn resolve(info: &CFType) -> Result<ResolvedPeer, RejectReason> {
    let dict = dictionary(info)?;
    let keys = security::info_keys();
    let epoch = match get(dict, keys.plist) {
        None => Field::Missing,
        Some(value) => {
            let plist = dictionary(&value)?;
            string(get(plist, &CFString::from_str(SECURITY_EPOCH_KEY)))
        }
    };
    Ok(ResolvedPeer {
        requirement: Ok(()), // Caller checked the exact role requirement first.
        dynamic_status: status(get(dict, keys.status)),
        entitlements: entitlements(get(dict, keys.entitlements)),
        security_epoch: epoch,
        team: string(get(dict, keys.team)),
        identifier: string(get(dict, keys.identifier)),
    })
}

#[cfg(test)]
mod tests;
