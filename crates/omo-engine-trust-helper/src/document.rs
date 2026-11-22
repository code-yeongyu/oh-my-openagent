//! The helper's stdout contract. `packages/omo-native/macos-trust-helper.ts` decodes exactly this shape,
//! rejects anything else, and derives the certificate facts (identity, CA flag, self-signed, EKU) from the
//! DER with the engine's own parser.

use serde::{Serialize, Serializer};
use std::io::Write;

pub const SCHEMA: u32 = 1;
/// Shared with `MAC_TRUST_HELPER_MAX_OUTPUT_BYTES`; the decoder enforces it again.
pub const MAX_OUTPUT_BYTES: usize = 8 * 1024 * 1024;
pub const EXIT_UNSUPPORTED: i32 = 64;
pub const EXIT_INTERNAL: i32 = 70;
/// Shared with `MAC_TRUST_HELPER_EXIT.outputCap`.
pub const EXIT_OUTPUT_CAP: i32 = 74;
/// Shared with `MAC_TRUST_HELPER_EXIT.watchdog`.
pub const EXIT_WATCHDOG: i32 = 75;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Document {
    pub schema: u32,
    pub os: &'static str,
    /// False when an applicable negative source (a trust-settings domain) could not be read completely.
    pub complete: bool,
    pub sources: Vec<Source>,
    pub certificates: Vec<Certificate>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SourceName {
    TrustSettingsUser,
    TrustSettingsAdmin,
    TrustSettingsSystem,
    KeychainSearchList,
}

/// An absent store, access denied and enumeration failure are distinct outcomes (design 6.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Outcome {
    Read,
    Absent,
    AccessDenied,
    EnumerationFailed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Source {
    pub name: SourceName,
    pub outcome: Outcome,
    /// The OSStatus behind the outcome; 0 when read.
    pub status: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CertificateSource {
    TrustSettings,
    Keychain,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Certificate {
    #[serde(serialize_with = "serialize_base64")]
    pub der: Vec<u8>,
    pub source: CertificateSource,
    pub settings: DomainSettings,
    /// Present exactly for keychain (intermediate) candidates.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chain: Option<Chain>,
}

/// `None` means no settings in that domain; `Some(vec![])` is Apple's unrestricted self-signed-root grant.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct DomainSettings {
    pub user: Option<Vec<Setting>>,
    pub admin: Option<Vec<Setting>>,
    pub system: Option<Vec<Setting>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Setting {
    /// `None` when the dictionary has no `kSecTrustSettingsPolicy`, meaning any policy.
    pub policy: Option<Policy>,
    pub application: bool,
    pub policy_string: Option<String>,
    pub key_usage: Option<i64>,
    pub allowed_errors: Vec<i64>,
    /// `None` when the dictionary has no `kSecTrustSettingsResult` (Apple's default, TrustRoot).
    pub result: Option<SettingResult>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Policy {
    pub oid: Option<String>,
    pub role: Option<Role>,
    pub name_constrained: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Server,
    Client,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum SettingResult {
    TrustRoot,
    TrustAsRoot,
    Deny,
    Unspecified,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Chain {
    /// The anchor the BasicX509 chain step reached (design revision 12), or `None` when it did not succeed.
    /// The EKU rule is the policy module's, applied to every member of `path`.
    pub anchor: Option<Identity>,
    /// The chain the evaluation built, leaf first.
    pub path: Vec<Identity>,
    pub explicit_distrust: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Identity {
    pub sha256: String,
    pub sha1: String,
}

#[derive(Debug)]
pub enum EncodeError {
    Serialize(serde_json::Error),
    Oversize(usize),
}

pub fn encode(document: &Document) -> Result<Vec<u8>, EncodeError> {
    let bytes = serde_json::to_vec(document).map_err(EncodeError::Serialize)?;
    if bytes.len() > MAX_OUTPUT_BYTES {
        return Err(EncodeError::Oversize(bytes.len()));
    }
    Ok(bytes)
}

/// Writes the whole document in one write, or nothing; returns the exit code.
pub fn emit(document: &Document) -> i32 {
    match encode(document) {
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

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// RFC 4648 base64 with padding, the canonical form the decoder requires.
pub fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let triple = chunk.iter().enumerate().fold(0u32, |acc, (index, byte)| {
            acc | (u32::from(*byte) << (16 - 8 * index))
        });
        for index in 0..4 {
            if index <= chunk.len() {
                out.push(char::from(
                    ALPHABET[((triple >> (18 - 6 * index)) & 63) as usize],
                ));
            } else {
                out.push('=');
            }
        }
    }
    out
}

fn serialize_base64<S: Serializer>(bytes: &[u8], serializer: S) -> Result<S::Ok, S::Error> {
    serializer.serialize_str(&base64(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_rfc4648_vectors() {
        for (input, expected) in [
            ("", ""),
            ("f", "Zg=="),
            ("fo", "Zm8="),
            ("foo", "Zm9v"),
            ("foob", "Zm9vYg=="),
            ("fooba", "Zm9vYmE="),
            ("foobar", "Zm9vYmFy"),
        ] {
            assert_eq!(base64(input.as_bytes()), expected);
        }
        assert_eq!(base64(&[0xfb, 0xff, 0xfe]), "+//+");
    }

    // The wire names are a cross-language contract with macos-trust-helper.ts.
    #[test]
    fn encodes_the_decoder_wire_shape() {
        let identity = Identity {
            sha256: "a".repeat(64),
            sha1: "b".repeat(40),
        };
        let document = Document {
            schema: SCHEMA,
            os: "macos",
            complete: true,
            sources: vec![Source {
                name: SourceName::TrustSettingsAdmin,
                outcome: Outcome::AccessDenied,
                status: -25293,
            }],
            certificates: vec![
                Certificate {
                    der: vec![1, 2, 3],
                    source: CertificateSource::TrustSettings,
                    settings: DomainSettings {
                        user: Some(vec![Setting {
                            policy: Some(Policy {
                                oid: Some("1.2.840.113635.100.1.3".into()),
                                role: Some(Role::Server),
                                name_constrained: false,
                            }),
                            application: false,
                            policy_string: None,
                            key_usage: Some(-1),
                            allowed_errors: vec![-2147409654],
                            result: Some(SettingResult::TrustAsRoot),
                        }]),
                        admin: None,
                        system: Some(vec![]),
                    },
                    chain: None,
                },
                Certificate {
                    der: vec![4],
                    source: CertificateSource::Keychain,
                    settings: DomainSettings::default(),
                    chain: Some(Chain {
                        anchor: Some(identity.clone()),
                        path: vec![identity],
                        explicit_distrust: true,
                    }),
                },
            ],
        };
        let text = String::from_utf8(encode(&document).expect("small document encodes"))
            .expect("JSON is UTF-8");
        let expected = concat!(
            r#"{"schema":1,"os":"macos","complete":true,"#,
            r#""sources":[{"name":"trust-settings-admin","outcome":"access-denied","status":-25293}],"#,
            r#""certificates":[{"der":"AQID","source":"trust-settings","settings":{"user":[{"policy":{"oid":"1.2.840.113635.100.1.3","role":"server","nameConstrained":false},"application":false,"policyString":null,"keyUsage":-1,"allowedErrors":[-2147409654],"result":"TrustAsRoot"}],"admin":null,"system":[]}},"#,
            r#"{"der":"BA==","source":"keychain","settings":{"user":null,"admin":null,"system":null},"chain":{"anchor":{"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","sha1":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},"path":[{"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","sha1":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}],"explicitDistrust":true}}]}"#,
        );
        assert_eq!(text, expected);
    }

    #[test]
    fn refuses_a_document_past_the_output_cap() {
        let document = Document {
            schema: SCHEMA,
            os: "macos",
            complete: true,
            sources: vec![],
            certificates: vec![Certificate {
                der: vec![0; MAX_OUTPUT_BYTES],
                source: CertificateSource::Keychain,
                settings: DomainSettings::default(),
                chain: None,
            }],
        };
        assert!(
            matches!(encode(&document), Err(EncodeError::Oversize(size)) if size > MAX_OUTPUT_BYTES)
        );
    }
}
