//! The Windows helper's stdout contract. `packages/omo-native/windows-trust-helper.ts` decodes exactly
//! this shape and rejects anything else. Identities, chains, outcomes, the output cap and the exit codes
//! are the shared ones in `document`.

use serde::Serialize;
use std::io::Write;

use crate::document::{base64, Chain, EncodeError, Identity, Outcome, EXIT_INTERNAL, EXIT_OUTPUT_CAP, MAX_OUTPUT_BYTES, SCHEMA};

/// Stdin was not Bun's bundled roots as concatenated DER certificates. Shared with `WINDOWS_TRUST_HELPER_EXIT.badStdin`.
pub const EXIT_BAD_STDIN: i32 = 65;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowsDocument {
    pub schema: u32,
    pub os: &'static str,
    /// False when an applicable negative source (a `Disallowed` store or the Disallowed CTL) was not read completely.
    pub complete: bool,
    pub sources: Vec<WindowsSource>,
    pub ctl: CtlOutcome,
    pub certificates: Vec<WindowsCertificate>,
    pub disallowed: Vec<DisallowedCertificate>,
    pub ctl_sha1: Vec<String>,
    pub bundled_roots: Vec<Identity>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
pub enum SourceStore {
    #[serde(rename = "ROOT")]
    Root,
    #[serde(rename = "CA")]
    Ca,
    TrustedPeople,
    Disallowed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Location {
    CurrentUser,
    LocalMachine,
    CurrentUserGroupPolicy,
    LocalMachineGroupPolicy,
    LocalMachineEnterprise,
    CurrentService,
    ServiceSid,
    UserSid,
}

impl Location {
    /// The five locations Bun reads today (design 4.2 item 1).
    pub const BUN: [Location; 5] = [
        Location::CurrentUser,
        Location::LocalMachine,
        Location::CurrentUserGroupPolicy,
        Location::LocalMachineGroupPolicy,
        Location::LocalMachineEnterprise,
    ];
    /// Machine `TrustedPeople` locations; current-user `TrustedPeople` is not read, as today.
    pub const MACHINE: [Location; 3] = [Location::LocalMachine, Location::LocalMachineGroupPolicy, Location::LocalMachineEnterprise];
}

/// One physical store, or the system store itself (`physical_store: None`) when it could not be opened or listed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowsSource {
    pub store: SourceStore,
    pub location: Location,
    pub physical_store: Option<String>,
    pub outcome: Outcome,
    /// The Win32 error behind the outcome; 0 when read.
    pub status: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CtlOutcome {
    Read,
    Absent,
    Unreadable,
    Undecodable,
    UnsupportedSubjectAlgorithm,
    /// An entry's length is not one the subject algorithm defines: 20 bytes for certificate SHA-1, 16 or 48 for
    /// disallowedHash (design 4.2 item 2).
    UnsupportedEntryLength,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Eku {
    Unrestricted,
    #[serde(rename = "none")]
    NoUsage,
    Error,
    Oids { oids: Vec<String> },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowsCertificate {
    #[serde(serialize_with = "serialize_base64")]
    pub der: Vec<u8>,
    pub store: SourceStore,
    pub location: Location,
    pub physical_store: String,
    pub self_signed: bool,
    pub ca: bool,
    pub eku: Eku,
    /// Present exactly for intermediate candidates (design 4.2 item 5).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chain: Option<Chain>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisallowedCertificate {
    #[serde(serialize_with = "serialize_base64")]
    pub der: Vec<u8>,
    pub location: Location,
    pub physical_store: String,
}

fn serialize_base64<S: serde::Serializer>(bytes: &[u8], serializer: S) -> Result<S::Ok, S::Error> {
    serializer.serialize_str(&base64(bytes))
}

/// `complete` is false when any applicable negative source could not be read completely (design 4.2 item 3).
/// An absent store or value holds no entries and keeps the scan complete.
pub fn negatives_complete(sources: &[WindowsSource], ctl: CtlOutcome) -> bool {
    let stores = sources.iter().all(|source| {
        source.store != SourceStore::Disallowed || !matches!(source.outcome, Outcome::AccessDenied | Outcome::EnumerationFailed)
    });
    stores && matches!(ctl, CtlOutcome::Read | CtlOutcome::Absent)
}

/// The whole document under `limit`, or an error; output is never truncated.
pub fn encode(document: &WindowsDocument, limit: usize) -> Result<Vec<u8>, EncodeError> {
    let bytes = serde_json::to_vec(document).map_err(EncodeError::Serialize)?;
    if bytes.len() > limit {
        return Err(EncodeError::Oversize(bytes.len()));
    }
    Ok(bytes)
}

/// Writes the whole document in one write, or nothing; returns the exit code.
pub fn emit(document: &WindowsDocument) -> i32 {
    match encode(document, MAX_OUTPUT_BYTES) {
        Ok(bytes) => {
            let mut stdout = std::io::stdout().lock();
            match stdout.write_all(&bytes).and_then(|()| stdout.flush()) {
                Ok(()) => 0,
                Err(_) => EXIT_INTERNAL,
            }
        }
        Err(EncodeError::Oversize(_)) => EXIT_OUTPUT_CAP,
        Err(EncodeError::Serialize(_)) => EXIT_INTERNAL,
    }
}

pub fn empty(complete: bool) -> WindowsDocument {
    WindowsDocument {
        schema: SCHEMA,
        os: "windows",
        complete,
        sources: vec![],
        ctl: CtlOutcome::Absent,
        certificates: vec![],
        disallowed: vec![],
        ctl_sha1: vec![],
        bundled_roots: vec![],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source(store: SourceStore, outcome: Outcome) -> WindowsSource {
        WindowsSource { store, location: Location::LocalMachine, physical_store: Some(".Default".into()), outcome, status: 0 }
    }

    #[test]
    fn unreadable_negative_sources_make_the_scan_incomplete() {
        for outcome in [Outcome::AccessDenied, Outcome::EnumerationFailed] {
            assert!(!negatives_complete(&[source(SourceStore::Disallowed, outcome)], CtlOutcome::Read));
            assert!(negatives_complete(&[source(SourceStore::Root, outcome)], CtlOutcome::Read));
        }
        for outcome in [Outcome::Read, Outcome::Absent] {
            assert!(negatives_complete(&[source(SourceStore::Disallowed, outcome)], CtlOutcome::Absent));
        }
        for ctl in [CtlOutcome::Unreadable, CtlOutcome::Undecodable, CtlOutcome::UnsupportedSubjectAlgorithm, CtlOutcome::UnsupportedEntryLength] {
            assert!(!negatives_complete(&[], ctl));
        }
    }

    // The wire names are a cross-language contract with windows-trust-helper.ts.
    #[test]
    fn encodes_the_decoder_wire_shape() {
        let identity = Identity { sha256: "a".repeat(64), sha1: "b".repeat(40) };
        let document = WindowsDocument {
            sources: vec![WindowsSource {
                store: SourceStore::TrustedPeople,
                location: Location::LocalMachineGroupPolicy,
                physical_store: None,
                outcome: Outcome::AccessDenied,
                status: 5,
            }],
            ctl: CtlOutcome::UnsupportedSubjectAlgorithm,
            certificates: vec![WindowsCertificate {
                der: vec![1, 2, 3],
                store: SourceStore::Ca,
                location: Location::UserSid,
                physical_store: ".Default".into(),
                self_signed: false,
                ca: true,
                eku: Eku::Oids { oids: vec!["1.3.6.1.5.5.7.3.1".into()] },
                chain: Some(Chain { anchor: None, path: vec![identity.clone()], explicit_distrust: true }),
            }],
            disallowed: vec![DisallowedCertificate { der: vec![4], location: Location::CurrentService, physical_store: ".Default".into() }],
            ctl_sha1: vec!["c".repeat(40)],
            bundled_roots: vec![identity],
            ..empty(true)
        };
        let value: serde_json::Value = serde_json::from_slice(&encode(&document, MAX_OUTPUT_BYTES).unwrap()).unwrap();
        let id = serde_json::json!({ "sha256": "a".repeat(64), "sha1": "b".repeat(40) });
        assert_eq!(
            value,
            serde_json::json!({
                "schema": 1, "os": "windows", "complete": true,
                "sources": [{ "store": "TrustedPeople", "location": "LOCAL_MACHINE_GROUP_POLICY", "physicalStore": null, "outcome": "access-denied", "status": 5 }],
                "ctl": "unsupported-subject-algorithm",
                "certificates": [{
                    "der": "AQID", "store": "CA", "location": "USER_SID", "physicalStore": ".Default", "selfSigned": false, "ca": true,
                    "eku": { "kind": "oids", "oids": ["1.3.6.1.5.5.7.3.1"] },
                    "chain": { "anchor": null, "path": [id], "explicitDistrust": true },
                }],
                "disallowed": [{ "der": "BA==", "location": "CURRENT_SERVICE", "physicalStore": ".Default" }],
                "ctlSha1": ["c".repeat(40)],
                "bundledRoots": [id],
            })
        );
        for (eku, kind) in [(Eku::Unrestricted, "unrestricted"), (Eku::NoUsage, "none"), (Eku::Error, "error")] {
            assert_eq!(serde_json::to_value(eku).unwrap(), serde_json::json!({ "kind": kind }));
        }
    }

    #[test]
    fn output_over_the_cap_is_refused_whole() {
        let document = empty(true);
        let size = encode(&document, MAX_OUTPUT_BYTES).unwrap().len();
        assert_eq!(encode(&document, size).map(|bytes| bytes.len()).ok(), Some(size));
        assert!(matches!(encode(&document, size - 1), Err(EncodeError::Oversize(actual)) if actual == size));
    }
}
