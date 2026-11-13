//! Security.framework facts (design 4.4 items 1 to 5). Every store is only read: nothing here writes a
//! keychain item or a trust setting, and chain evaluation never fetches from the network.

use crate::document::{
    hex, Certificate, CertificateSource, Chain, Document, DomainSettings, Identity, Outcome,
    Policy, Role, Setting, SettingResult, Source, SourceName, SCHEMA,
};
use core::ffi::c_void;
use core::ptr::{self, NonNull};
use objc2_core_foundation::{
    CFArray, CFBoolean, CFDictionary, CFError, CFNumber, CFRetained, CFString, CFType,
};
use objc2_security::{
    errSecAuthFailed, errSecInteractionNotAllowed, errSecItemNotFound, errSecNoTrustSettings,
    kSecClass, kSecClassCertificate, kSecMatchLimit, kSecMatchLimitAll, kSecPolicyClient,
    kSecPolicyName, kSecPolicyOid, kSecReturnRef, SecCertificate, SecItemCopyMatching, SecPolicy,
    SecTrust, SecTrustResultType, SecTrustSettingsDomain,
};
use std::collections::{HashMap, HashSet};

const SSL_OID: &str = "1.2.840.113635.100.1.3";
/// SecBase.h statuses that mean the store refused this identity: errSecAuthFailed,
/// errSecInteractionNotAllowed, errSecNoAccessForItem, errSecWrPerm, errSecMissingEntitlement and
/// userCanceledErr. Any other failure is an enumeration failure.
const ACCESS_DENIED: [i32; 6] = [
    errSecAuthFailed,
    errSecInteractionNotAllowed,
    -25243,
    -61,
    -34018,
    -128,
];
/// errSecDecode: a trust-settings value of a type the SDK does not allow.
const UNREADABLE_STATUS: i32 = -26275;

extern "C" {
    // CommonCrypto, part of libSystem.
    fn CC_SHA1(data: *const c_void, len: u32, md: *mut u8) -> *mut u8;
    fn CC_SHA256(data: *const c_void, len: u32, md: *mut u8) -> *mut u8;
}

/// A trust-settings value whose type the SDK does not allow; the dictionary cannot be read completely.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Unreadable(pub &'static str);

pub fn identity(der: &[u8]) -> Identity {
    let length = u32::try_from(der.len()).expect("a certificate is smaller than 4 GiB");
    let mut sha256 = [0u8; 32];
    let mut sha1 = [0u8; 20];
    unsafe {
        CC_SHA256(der.as_ptr().cast(), length, sha256.as_mut_ptr());
        CC_SHA1(der.as_ptr().cast(), length, sha1.as_mut_ptr());
    }
    Identity {
        sha256: hex(&sha256),
        sha1: hex(&sha1),
    }
}

pub fn certificate_der(certificate: &SecCertificate) -> Vec<u8> {
    unsafe { certificate.data() }.to_vec()
}

fn typed(dictionary: &CFDictionary) -> &CFDictionary<CFString, CFType> {
    // Lookups use the dictionary's own callbacks; every value is a CFType.
    unsafe { dictionary.cast_unchecked() }
}

fn number(value: &CFType, key: &'static str) -> Result<i64, Unreadable> {
    value
        .downcast_ref::<CFNumber>()
        .and_then(CFNumber::as_i64)
        .ok_or(Unreadable(key))
}

/// Projects `kSecTrustSettingsPolicy` (a `SecPolicyRef`) through `SecPolicyCopyProperties` (design 4.4
/// item 2). SSL client and server policies share one OID; only `kSecPolicyClient` tells them apart.
fn project_policy(value: &CFType) -> Policy {
    let unknown = Policy {
        oid: None,
        role: Some(Role::Unknown),
        name_constrained: false,
    };
    let Some(policy) = value.downcast_ref::<SecPolicy>() else {
        return unknown;
    };
    let Some(properties) = (unsafe { policy.properties() }) else {
        return unknown;
    };
    let properties = typed(&properties);
    let oid = properties
        .get(unsafe { kSecPolicyOid })
        .and_then(|value| value.downcast_ref::<CFString>().map(ToString::to_string));
    let role = match oid.as_deref() {
        Some(SSL_OID) => Some(match properties.get(unsafe { kSecPolicyClient }) {
            // Absent means server evaluation (SecPolicy.h).
            None => Role::Server,
            Some(client) => match client.downcast_ref::<CFBoolean>() {
                Some(flag) if flag.as_bool() => Role::Client,
                Some(_) => Role::Server,
                None => Role::Unknown,
            },
        }),
        Some(_) => None,
        None => Some(Role::Unknown),
    };
    // A hostname scope carried inside the policy object, as a string or an array; any value scopes it.
    let name_constrained = properties.get(unsafe { kSecPolicyName }).is_some();
    Policy {
        oid,
        role,
        name_constrained,
    }
}

/// Projects one `SecTrustSettingsCopyTrustSettings` dictionary, reading exactly the six keys the SDK
/// defines (`SecTrustSettings.h`). A malformed policy projects as unknown and never grants; any other
/// value of the wrong type makes the dictionary unreadable.
pub fn project_trust_settings_dictionary(dictionary: &CFDictionary) -> Result<Setting, Unreadable> {
    let dictionary = typed(dictionary);
    let get = |key: &'static str| dictionary.get(&CFString::from_static_str(key));
    let policy_string = match get("kSecTrustSettingsPolicyString") {
        None => None,
        Some(value) => Some(
            value
                .downcast_ref::<CFString>()
                .ok_or(Unreadable("kSecTrustSettingsPolicyString"))?
                .to_string(),
        ),
    };
    let key_usage = get("kSecTrustSettingsKeyUsage")
        .map(|value| number(&value, "kSecTrustSettingsKeyUsage"))
        .transpose()?;
    let allowed_errors = get("kSecTrustSettingsAllowedError")
        .map(|value| number(&value, "kSecTrustSettingsAllowedError"))
        .transpose()?
        .into_iter()
        .collect();
    let result = get("kSecTrustSettingsResult")
        .map(|value| match number(&value, "kSecTrustSettingsResult")? {
            1 => Ok(SettingResult::TrustRoot),
            2 => Ok(SettingResult::TrustAsRoot),
            3 => Ok(SettingResult::Deny),
            4 => Ok(SettingResult::Unspecified),
            _ => Err(Unreadable("kSecTrustSettingsResult")),
        })
        .transpose()?;
    Ok(Setting {
        policy: get("kSecTrustSettingsPolicy").map(|value| project_policy(&value)),
        application: get("kSecTrustSettingsApplication").is_some(),
        policy_string,
        key_usage,
        allowed_errors,
        result,
    })
}

fn certificates_of(array: &CFArray) -> Option<Vec<CFRetained<SecCertificate>>> {
    let array: &CFArray<CFType> = unsafe { array.cast_unchecked() };
    array
        .iter()
        .map(|item| item.downcast::<SecCertificate>().ok())
        .collect()
}

fn failure(status: i32) -> Outcome {
    if ACCESS_DENIED.contains(&status) {
        Outcome::AccessDenied
    } else {
        Outcome::EnumerationFailed
    }
}

struct StoreRead {
    outcome: Outcome,
    status: i32,
    certificates: Vec<CFRetained<SecCertificate>>,
}

impl StoreRead {
    fn failed(outcome: Outcome, status: i32) -> Self {
        StoreRead {
            outcome,
            status,
            certificates: Vec::new(),
        }
    }
}

fn read_domain(domain: SecTrustSettingsDomain) -> StoreRead {
    let mut array: *const CFArray = ptr::null();
    let status = unsafe { SecTrust::settings_copy_certificates(domain, &mut array) };
    let array = NonNull::new(array.cast_mut()).map(|array| unsafe { CFRetained::from_raw(array) });
    match (status, array) {
        (0, Some(array)) => match certificates_of(&array) {
            Some(certificates) => StoreRead {
                outcome: Outcome::Read,
                status,
                certificates,
            },
            None => StoreRead::failed(Outcome::EnumerationFailed, UNREADABLE_STATUS),
        },
        (0, None) => StoreRead::failed(Outcome::EnumerationFailed, UNREADABLE_STATUS),
        (status, _) if status == errSecNoTrustSettings || status == errSecItemNotFound => {
            StoreRead::failed(Outcome::Absent, status)
        }
        (status, _) => StoreRead::failed(failure(status), status),
    }
}

/// `Ok(None)` is no settings in this domain; `Ok(Some(vec![]))` is the empty, unrestricted array.
fn read_settings(
    certificate: &SecCertificate,
    domain: SecTrustSettingsDomain,
) -> Result<Option<Vec<Setting>>, i32> {
    let mut array: *const CFArray = ptr::null();
    let status = unsafe {
        SecTrust::settings_copy_trust_settings(certificate, domain, NonNull::from(&mut array))
    };
    let array = NonNull::new(array.cast_mut()).map(|array| unsafe { CFRetained::from_raw(array) });
    match (status, array) {
        (0, Some(array)) => {
            let array: &CFArray<CFType> = unsafe { array.cast_unchecked() };
            array
                .iter()
                .map(|item| {
                    let dictionary = item
                        .downcast::<CFDictionary>()
                        .map_err(|_| UNREADABLE_STATUS)?;
                    project_trust_settings_dictionary(&dictionary).map_err(|_| UNREADABLE_STATUS)
                })
                .collect::<Result<Vec<_>, _>>()
                .map(Some)
        }
        (0, None) => Err(UNREADABLE_STATUS),
        (status, _) if status == errSecItemNotFound || status == errSecNoTrustSettings => Ok(None),
        (status, _) => Err(status),
    }
}

fn read_keychain() -> StoreRead {
    let (class, limit, return_ref) = unsafe { (kSecClass, kSecMatchLimit, kSecReturnRef) };
    let values: [&CFType; 3] = [
        unsafe { kSecClassCertificate },
        unsafe { kSecMatchLimitAll },
        CFBoolean::new(true),
    ];
    let query = CFDictionary::<CFString, CFType>::from_slices(&[class, limit, return_ref], &values);
    let mut result: *const CFType = ptr::null();
    let status = unsafe { SecItemCopyMatching(query.as_opaque(), &mut result) };
    let result =
        NonNull::new(result.cast_mut()).map(|result| unsafe { CFRetained::from_raw(result) });
    match (status, result) {
        (0, Some(result)) => {
            let certificates = match result.downcast::<CFArray>() {
                Ok(array) => certificates_of(&array),
                Err(single) => single
                    .downcast::<SecCertificate>()
                    .ok()
                    .map(|certificate| vec![certificate]),
            };
            match certificates {
                Some(certificates) => StoreRead {
                    outcome: Outcome::Read,
                    status,
                    certificates,
                },
                None => StoreRead::failed(Outcome::EnumerationFailed, UNREADABLE_STATUS),
            }
        }
        (0, None) => StoreRead::failed(Outcome::EnumerationFailed, UNREADABLE_STATUS),
        (status, _) if status == errSecItemNotFound => StoreRead::failed(Outcome::Absent, status),
        (status, _) => StoreRead::failed(failure(status), status),
    }
}

/// The chain step for one intermediate candidate under the root candidates only (design 4.4 item 3,
/// revision 12 option C): `SecPolicyCreateBasicX509()`, custom anchors only, no network fetch. Under
/// custom anchors the strict SSL server policy rejects CA certificates valid for more than 825 days or
/// without a serverAuth EKU (measured), so the EKU rule is applied by the policy module instead.
pub fn evaluate_intermediate(
    certificate: &SecCertificate,
    anchors: &[CFRetained<SecCertificate>],
) -> Chain {
    let unanchored = Chain {
        anchor: None,
        path: Vec::new(),
        explicit_distrust: false,
    };
    let policy = unsafe { SecPolicy::new_basic_x509() };
    let mut trust: *mut SecTrust = ptr::null_mut();
    let status = unsafe {
        SecTrust::create_with_certificates(certificate, Some(&policy), NonNull::from(&mut trust))
    };
    let Some(trust) = NonNull::new(trust).map(|trust| unsafe { CFRetained::from_raw(trust) })
    else {
        return unanchored;
    };
    let anchor_array = CFArray::from_retained_objects(anchors);
    let configured = status == 0
        && unsafe {
            trust.set_anchor_certificates(Some(anchor_array.as_opaque())) == 0
                && trust.set_anchor_certificates_only(true) == 0
                && trust.set_network_fetch_allowed(false) == 0
        };
    if !configured {
        return unanchored;
    }
    let mut error: *mut CFError = ptr::null_mut();
    let trusted = unsafe { trust.evaluate_with_error(&mut error) };
    if let Some(error) = NonNull::new(error) {
        drop(unsafe { CFRetained::from_raw(error) });
    }
    let mut result = SecTrustResultType::Invalid;
    let explicit_distrust = unsafe { trust.trust_result(NonNull::from(&mut result)) } == 0
        && result == SecTrustResultType::Deny;
    let chain = unsafe { trust.certificate_chain() }
        .and_then(|chain| certificates_of(&chain))
        .unwrap_or_default();
    let anchor = match chain.last() {
        Some(last) if trusted && anchors.iter().any(|anchor| **anchor == **last) => {
            Some(identity(&certificate_der(last)))
        }
        _ => None,
    };
    let path = chain
        .iter()
        .map(|member| identity(&certificate_der(member)))
        .collect();
    Chain {
        anchor,
        path,
        explicit_distrust,
    }
}

/// Reads every applicable source once. A trust-settings domain that cannot be read completely makes the
/// document incomplete, because every domain can carry a Deny (design 4.5).
pub fn collect() -> Document {
    let mut sources = Vec::with_capacity(4);
    let mut order: Vec<Vec<u8>> = Vec::new();
    let mut entries: HashMap<Vec<u8>, (CFRetained<SecCertificate>, DomainSettings)> =
        HashMap::new();
    for (name, domain) in [
        (SourceName::TrustSettingsUser, SecTrustSettingsDomain::User),
        (
            SourceName::TrustSettingsAdmin,
            SecTrustSettingsDomain::Admin,
        ),
        (
            SourceName::TrustSettingsSystem,
            SecTrustSettingsDomain::System,
        ),
    ] {
        let read = read_domain(domain);
        let (mut outcome, mut status) = (read.outcome, read.status);
        for certificate in read.certificates {
            let settings = match read_settings(&certificate, domain) {
                Ok(Some(settings)) => settings,
                Ok(None) => continue,
                Err(error) => {
                    if outcome == Outcome::Read {
                        (outcome, status) = (failure(error), error);
                    }
                    continue;
                }
            };
            let der = certificate_der(&certificate);
            let entry = entries.entry(der.clone()).or_insert_with(|| {
                order.push(der);
                (certificate, DomainSettings::default())
            });
            let slot = match name {
                SourceName::TrustSettingsUser => &mut entry.1.user,
                SourceName::TrustSettingsAdmin => &mut entry.1.admin,
                _ => &mut entry.1.system,
            };
            *slot = Some(settings);
        }
        sources.push(Source {
            name,
            outcome,
            status,
        });
    }
    let complete = sources
        .iter()
        .all(|source| matches!(source.outcome, Outcome::Read | Outcome::Absent));
    let anchors: Vec<CFRetained<SecCertificate>> =
        order.iter().map(|der| entries[der].0.clone()).collect();
    let mut certificates: Vec<Certificate> = order
        .iter()
        .map(|der| Certificate {
            der: der.clone(),
            source: CertificateSource::TrustSettings,
            settings: entries[der].1.clone(),
            chain: None,
        })
        .collect();
    // Keychain certificates without settings of their own are intermediate candidates; the policy keeps
    // only CA certificates, so non-CA ones are reported and dropped there.
    let keychain = read_keychain();
    let mut seen: HashSet<Vec<u8>> = order.into_iter().collect();
    for certificate in &keychain.certificates {
        let der = certificate_der(certificate);
        if !seen.insert(der.clone()) {
            continue;
        }
        certificates.push(Certificate {
            der,
            source: CertificateSource::Keychain,
            settings: DomainSettings::default(),
            chain: Some(evaluate_intermediate(certificate, &anchors)),
        });
    }
    sources.push(Source {
        name: SourceName::KeychainSearchList,
        outcome: keychain.outcome,
        status: keychain.status,
    });
    Document {
        schema: SCHEMA,
        os: "macos",
        complete,
        sources,
        certificates,
    }
}
