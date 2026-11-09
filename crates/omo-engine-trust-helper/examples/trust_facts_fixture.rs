//! Test fixture for `packages/omo-native/test/macos-trust-helper.macos.test.ts` (design 9.3).
//!
//! Builds in-memory trust-settings dictionaries around real `SecPolicyCreateSSL` objects and in-memory
//! certificates, runs them through the helper's production projection and chain evaluation, and prints
//! the helper's document so the TypeScript decoder and `selectEngineTrust` consume it unchanged. It never
//! reads or writes a keychain or trust store. Not shipped.
//!
//! Usage: `trust_facts_fixture role <server-grant|client-grant|non-policy-grant|client-deny> <root.der>`
//!        `trust_facts_fixture intermediate <root.der> <intermediate.der>`

#[cfg(target_os = "macos")]
fn main() {
    std::process::exit(fixture::run());
}

#[cfg(not(target_os = "macos"))]
fn main() {
    std::process::exit(omo_engine_trust_helper::document::EXIT_UNSUPPORTED);
}

#[cfg(target_os = "macos")]
mod fixture {
    use objc2_core_foundation::{CFData, CFDictionary, CFNumber, CFRetained, CFString, CFType};
    use objc2_security::{SecCertificate, SecPolicy};
    use omo_engine_trust_helper::document::{
        emit, Certificate, CertificateSource, Document, DomainSettings, Outcome, Setting, Source,
        SourceName, EXIT_UNSUPPORTED, SCHEMA,
    };
    use omo_engine_trust_helper::macos::{
        certificate_der, evaluate_intermediate, project_trust_settings_dictionary,
    };

    fn certificate(path: &str) -> CFRetained<SecCertificate> {
        let bytes = std::fs::read(path).expect("fixture DER is readable");
        unsafe { SecCertificate::with_data(None, &CFData::from_bytes(&bytes)) }
            .expect("fixture DER is a certificate")
    }

    fn document(certificates: Vec<Certificate>) -> Document {
        let read = |name| Source {
            name,
            outcome: Outcome::Read,
            status: 0,
        };
        Document {
            schema: SCHEMA,
            os: "macos",
            complete: true,
            sources: vec![
                read(SourceName::TrustSettingsUser),
                read(SourceName::TrustSettingsAdmin),
                read(SourceName::TrustSettingsSystem),
                read(SourceName::KeychainSearchList),
            ],
            certificates,
        }
    }

    fn role(case: &str, root: &str) -> Document {
        let root = certificate(root);
        let server = unsafe { SecPolicy::new_ssl(true, None) };
        let client = unsafe { SecPolicy::new_ssl(false, None) };
        let not_a_policy = CFString::from_static_str("not-a-policy");
        let (policy, result): (&CFType, i32) = match case {
            "server-grant" => (&server, 1),
            "client-grant" => (&client, 1),
            "non-policy-grant" => (&not_a_policy, 1),
            "client-deny" => (&client, 3),
            other => panic!("unknown role case {other}"),
        };
        let result = CFNumber::new_i32(result);
        let keys = [
            CFString::from_static_str("kSecTrustSettingsPolicy"),
            CFString::from_static_str("kSecTrustSettingsResult"),
        ];
        let dictionary = CFDictionary::<CFString, CFType>::from_slices(
            &[&keys[0], &keys[1]],
            &[policy, &result],
        );
        let setting = project_trust_settings_dictionary(dictionary.as_opaque())
            .expect("in-memory dictionary projects");
        document(vec![Certificate {
            der: certificate_der(&root),
            source: CertificateSource::TrustSettings,
            settings: DomainSettings {
                user: Some(vec![setting]),
                admin: None,
                system: None,
            },
            chain: None,
        }])
    }

    /// `root_deny`: the root carries a user-domain Deny (projected from a real dictionary) instead of a grant.
    fn intermediate(root: &str, intermediate: &str, root_deny: bool) -> Document {
        let root = certificate(root);
        let intermediate = certificate(intermediate);
        let chain = evaluate_intermediate(&intermediate, std::slice::from_ref(&root));
        document(vec![
            Certificate {
                der: certificate_der(&root),
                source: CertificateSource::TrustSettings,
                settings: DomainSettings {
                    user: Some(if root_deny { vec![deny()] } else { vec![] }),
                    admin: None,
                    system: None,
                },
                chain: None,
            },
            Certificate {
                der: certificate_der(&intermediate),
                source: CertificateSource::Keychain,
                settings: DomainSettings::default(),
                chain: Some(chain),
            },
        ])
    }

    fn deny() -> Setting {
        let result = CFNumber::new_i32(3);
        let key = CFString::from_static_str("kSecTrustSettingsResult");
        let dictionary = CFDictionary::<CFString, CFType>::from_slices(&[&key], &[&result]);
        project_trust_settings_dictionary(dictionary.as_opaque())
            .expect("in-memory dictionary projects")
    }

    pub fn run() -> i32 {
        let args: Vec<String> = std::env::args().skip(1).collect();
        let args: Vec<&str> = args.iter().map(String::as_str).collect();
        match args.as_slice() {
            ["role", case, root] => emit(&role(case, root)),
            ["intermediate", root, leaf] => emit(&intermediate(root, leaf, false)),
            ["intermediate", root, leaf, "root-deny"] => emit(&intermediate(root, leaf, true)),
            _ => EXIT_UNSUPPORTED,
        }
    }
}
