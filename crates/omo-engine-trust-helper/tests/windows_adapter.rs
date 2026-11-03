//! Real Crypt32 on CERT_STORE_PROV_MEMORY stores (design 9.2). Certificates come from the OpenSSL CLI in a
//! test-owned directory; system-store enumeration is replaced through `SystemStores`. No real store is read.
#![cfg(target_os = "windows")]

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;

use omo_engine_trust_helper::document::{Chain, Identity, Outcome};
use omo_engine_trust_helper::windows::{
    collect, decode_disallowed_ctl, effective_eku, CertStore, CollectError, Context, CtlRead, PhysicalRead, System, SystemStores,
};
use omo_engine_trust_helper::windows_document::{CtlOutcome, Eku, Location, SourceStore};
use windows_sys::Win32::Security::Cryptography::{
    CertCreateCTLContext, CertFreeCTLContext, CertSetCertificateContextProperty, CryptEncodeObjectEx,
    CERT_DISALLOWED_FILETIME_PROP_ID, CERT_ENHKEY_USAGE_PROP_ID, CRYPT_INTEGER_BLOB, CTL_USAGE, PKCS_7_ASN_ENCODING,
    X509_ASN_ENCODING, X509_ENHANCED_KEY_USAGE,
};

const SERVER_AUTH: &str = "1.3.6.1.5.5.7.3.1";
const CLIENT_AUTH: &str = "1.3.6.1.5.5.7.3.2";
const CODE_SIGNING: &str = "1.3.6.1.5.5.7.3.3";
const CONFIG: &str = "[req]
distinguished_name = dn
[dn]
[root]
basicConstraints = critical,CA:TRUE
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
[intermediate]
basicConstraints = critical,CA:TRUE
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
[intermediate_server]
basicConstraints = critical,CA:TRUE
keyUsage = critical,keyCertSign,cRLSign
extendedKeyUsage = serverAuth
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
[server_client]
basicConstraints = critical,CA:FALSE
extendedKeyUsage = serverAuth,clientAuth
[signer]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature
";

struct Cert {
    der: Vec<u8>,
    pem: PathBuf,
    key: PathBuf,
}

struct Pki {
    dir: tempfile::TempDir,
    serial: std::cell::Cell<u32>,
}

impl Pki {
    fn new() -> Pki {
        let dir = tempfile::Builder::new().prefix("omo-trust-helper-").tempdir().unwrap();
        std::fs::write(dir.path().join("openssl.cnf"), CONFIG).unwrap();
        Pki { dir, serial: std::cell::Cell::new(1) }
    }

    fn openssl(&self, args: &[&str]) -> Vec<u8> {
        let output = Command::new("openssl")
            .args(args)
            .env("OPENSSL_CONF", self.dir.path().join("openssl.cnf"))
            .env("MSYS_NO_PATHCONV", "1")
            .env("MSYS2_ARG_CONV_EXCL", "*")
            .output()
            .expect("the OpenSSL CLI must be on PATH");
        assert!(output.status.success(), "openssl {args:?}: {}", String::from_utf8_lossy(&output.stderr));
        output.stdout
    }

    fn path(&self, name: &str) -> String {
        self.dir.path().join(name).to_str().unwrap().to_owned()
    }

    fn next_serial(&self) -> String {
        let serial = self.serial.get();
        self.serial.set(serial + 1);
        serial.to_string()
    }

    fn load(&self, name: &str) -> Cert {
        let pem = self.path(&format!("{name}.pem"));
        let der = self.path(&format!("{name}.der"));
        self.openssl(&["x509", "-in", &pem, "-outform", "DER", "-out", &der]);
        Cert { der: std::fs::read(&der).unwrap(), pem: pem.into(), key: self.path(&format!("{name}.key")).into() }
    }

    fn root(&self, name: &str, section: &str) -> Cert {
        let config = self.path("openssl.cnf");
        let (key, pem, serial) = (self.path(&format!("{name}.key")), self.path(&format!("{name}.pem")), self.next_serial());
        let subject = format!("/CN=Example Trust Test synthetic {name}");
        self.openssl(&[
            "req", "-config", &config, "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes",
            "-subj", &subject, "-days", "30", "-extensions", section, "-set_serial", &serial, "-keyout", &key, "-out", &pem,
        ]);
        self.load(name)
    }

    fn issued(&self, name: &str, issuer: &Cert, section: &str) -> Cert {
        self.issued_with(name, issuer, section, "-sha256")
    }

    /// `digest` is the OpenSSL flag of the signature's digest, so the signature algorithm varies per certificate.
    fn issued_with(&self, name: &str, issuer: &Cert, section: &str, digest: &str) -> Cert {
        let config = self.path("openssl.cnf");
        let (key, pem, csr, serial) = (
            self.path(&format!("{name}.key")),
            self.path(&format!("{name}.pem")),
            self.path(&format!("{name}.csr")),
            self.next_serial(),
        );
        let subject = format!("/CN=Example Trust Test synthetic {name}");
        self.openssl(&[
            "req", "-config", &config, "-new", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes",
            "-subj", &subject, "-keyout", &key, "-out", &csr,
        ]);
        self.openssl(&[
            "x509", "-req", "-in", &csr, "-CA", issuer.pem.to_str().unwrap(), "-CAkey", issuer.key.to_str().unwrap(),
            "-days", "30", "-set_serial", &serial, "-extfile", &config, "-extensions", section, digest, "-out", &pem,
        ]);
        self.load(name)
    }

    /// The certificate's SubjectPublicKeyInfo DER, as OpenSSL encodes it.
    fn subject_public_key_info(&self, cert: &Cert) -> Vec<u8> {
        let spki = self.openssl(&["x509", "-in", cert.pem.to_str().unwrap(), "-noout", "-pubkey"]);
        let serial = self.next_serial();
        let (pem, der) = (self.path(&format!("spki-{serial}.pem")), self.path(&format!("spki-{serial}.der")));
        std::fs::write(&pem, spki).unwrap();
        self.openssl(&["pkey", "-pubin", "-in", &pem, "-outform", "DER", "-out", &der]);
        std::fs::read(&der).unwrap()
    }

    fn md5(&self, bytes: &[u8]) -> Vec<u8> {
        let input = self.path(&format!("md5-{}.bin", self.next_serial()));
        std::fs::write(&input, bytes).unwrap();
        self.openssl(&["dgst", "-md5", "-binary", &input])
    }

    /// MD5 of the subjectPublicKey BIT STRING contents after the unused-bits byte, computed by OpenSSL.
    fn public_key_md5(&self, cert: &Cert) -> Vec<u8> {
        let spki = self.subject_public_key_info(cert);
        let (outer, _) = header(&spki);
        let (algorithm_header, algorithm_length) = header(&spki[outer..]);
        let bits = &spki[outer + algorithm_header + algorithm_length..];
        let (bits_header, bits_length) = header(bits);
        self.md5(&bits[bits_header + 1..bits_header + bits_length])
    }

    /// MD5 of the whole SubjectPublicKeyInfo DER: not a disallowedHash form.
    fn subject_public_key_info_md5(&self, cert: &Cert) -> Vec<u8> {
        self.md5(&self.subject_public_key_info(cert))
    }

    /// The digest of the certificate's TBSCertificate, computed by OpenSSL, independent of Crypt32.
    fn to_be_signed_digest(&self, cert: &Cert, digest: &str) -> Vec<u8> {
        let serial = self.next_serial();
        let input = self.path(&format!("tbs-{serial}.der"));
        std::fs::write(&input, to_be_signed(&cert.der)).unwrap();
        self.openssl(&["dgst", digest, "-binary", &input])
    }

    /// CMS SignedData whose content type is szOID_CTL, signed by a throwaway signer.
    fn sign_ctl(&self, content: &[u8], signer: &Cert) -> Vec<u8> {
        let serial = self.next_serial();
        let (input, output) = (self.path(&format!("ctl-{serial}.der")), self.path(&format!("ctl-{serial}.p7")));
        std::fs::write(&input, content).unwrap();
        self.openssl(&[
            "cms", "-sign", "-binary", "-nodetach", "-outform", "DER", "-econtent_type", "1.3.6.1.4.1.311.10.1", "-md",
            "sha256", "-in", &input, "-signer", signer.pem.to_str().unwrap(), "-inkey", signer.key.to_str().unwrap(),
            "-out", &output,
        ]);
        std::fs::read(output).unwrap()
    }

    /// The identity OpenSSL computes, independent of Crypt32's hashing.
    fn identity(&self, cert: &Cert) -> Identity {
        let pem = cert.pem.to_str().unwrap();
        let fingerprint = |digest: &str| {
            let text = String::from_utf8(self.openssl(&["x509", "-in", pem, "-noout", "-fingerprint", digest])).unwrap();
            text.trim().rsplit('=').next().unwrap().replace(':', "").to_lowercase()
        };
        Identity { sha256: fingerprint("-sha256"), sha1: fingerprint("-sha1") }
    }
}

/// The header length and content length of the DER element at the start of `der`.
fn header(der: &[u8]) -> (usize, usize) {
    match der[1] {
        short if short < 0x80 => (2, short as usize),
        long => {
            let count = (long & 0x7f) as usize;
            (2 + count, der[2..2 + count].iter().fold(0, |size, byte| size * 256 + *byte as usize))
        }
    }
}

/// The TBSCertificate element: the first element inside the certificate SEQUENCE.
fn to_be_signed(der: &[u8]) -> &[u8] {
    let (outer, _) = header(der);
    let (inner, length) = header(&der[outer..]);
    &der[outer..outer + inner + length]
}

fn tlv(tag: u8, parts: &[&[u8]]) -> Vec<u8> {
    let body = parts.concat();
    let mut out = vec![tag];
    if body.len() < 0x80 {
        out.push(body.len() as u8);
    } else {
        let size = body.len().to_be_bytes();
        let size = &size[size.iter().position(|byte| *byte != 0).unwrap()..];
        out.push(0x80 | size.len() as u8);
        out.extend_from_slice(size);
    }
    out.extend_from_slice(&body);
    out
}

fn oid(dotted: &str) -> Vec<u8> {
    let arcs: Vec<u64> = dotted.split('.').map(|arc| arc.parse().unwrap()).collect();
    let mut bytes = vec![(arcs[0] * 40 + arcs[1]) as u8];
    for arc in &arcs[2..] {
        let mut chunk = vec![(arc & 0x7f) as u8];
        let mut value = arc >> 7;
        while value > 0 {
            chunk.insert(0, (value & 0x7f) as u8 | 0x80);
            value >>= 7;
        }
        bytes.extend(chunk);
    }
    tlv(0x06, &[&bytes])
}

/// A CertificateTrustList body: Disallowed-list usage, thisUpdate, the subject algorithm and the subjects.
fn ctl_content(subjects: &[&[u8]], subject_algorithm: &str) -> Vec<u8> {
    let entries: Vec<Vec<u8>> = subjects.iter().map(|subject| tlv(0x30, &[&tlv(0x04, &[subject])])).collect();
    let entries: Vec<&[u8]> = entries.iter().map(Vec::as_slice).collect();
    tlv(0x30, &[
        &tlv(0x30, &[&oid("1.3.6.1.4.1.311.10.3.30")]),
        &tlv(0x17, &[b"260101000000Z"]),
        &tlv(0x30, &[&oid(subject_algorithm), &tlv(0x05, &[])]),
        &tlv(0x30, &entries),
    ])
}

/// Sets the EKU property through CertSetCertificateContextProperty, as an administrator's restriction does.
fn set_eku_property(context: &Context, oids: &[&str]) {
    let mut names: Vec<Vec<u8>> = oids.iter().map(|oid| format!("{oid}\0").into_bytes()).collect();
    let mut pointers: Vec<*mut u8> = names.iter_mut().map(|name| name.as_mut_ptr()).collect();
    let usage = CTL_USAGE { cUsageIdentifier: pointers.len() as u32, rgpszUsageIdentifier: pointers.as_mut_ptr() };
    let mut size = 0u32;
    unsafe {
        let encode = |buffer: *mut u8, size: &mut u32| {
            CryptEncodeObjectEx(X509_ASN_ENCODING, X509_ENHANCED_KEY_USAGE, &usage as *const _ as _, 0, std::ptr::null(), buffer as _, size)
        };
        assert_ne!(encode(std::ptr::null_mut(), &mut size), 0);
        let mut encoded = vec![0u8; size as usize];
        assert_ne!(encode(encoded.as_mut_ptr(), &mut size), 0);
        let blob = CRYPT_INTEGER_BLOB { cbData: size, pbData: encoded.as_mut_ptr() };
        assert_ne!(CertSetCertificateContextProperty(context.as_ptr(), CERT_ENHKEY_USAGE_PROP_ID, 0, &blob as *const _ as _), 0);
    }
}

#[derive(Default)]
struct MemoryStores {
    stores: HashMap<(SourceStore, Location), Result<CertStore, (Outcome, u32)>>,
    ctl: Option<CtlRead>,
    disallowed_locations: Vec<Location>,
    requested: Vec<(SourceStore, Location)>,
}

impl MemoryStores {
    fn with(mut self, store: SourceStore, location: Location, certificates: &[&Cert]) -> (Self, Vec<Context>) {
        let memory = CertStore::memory().unwrap();
        let contexts = certificates.iter().map(|cert| memory.add_encoded(&cert.der).unwrap()).collect();
        self.stores.insert((store, location), Ok(memory));
        (self, contexts)
    }

    fn with_der(mut self, store: SourceStore, location: Location, certificates: &[&[u8]]) -> Self {
        let memory = CertStore::memory().unwrap();
        for der in certificates {
            memory.add_encoded(der).unwrap();
        }
        self.stores.insert((store, location), Ok(memory));
        self
    }

    fn failing(mut self, store: SourceStore, location: Location, outcome: Outcome) -> Self {
        // A representative Win32 error per outcome; the adapter reports it unchanged.
        let status = match outcome {
            Outcome::AccessDenied => 5,
            Outcome::Absent => 2,
            _ => 0x8009_2004,
        };
        self.stores.insert((store, location), Err((outcome, status)));
        self
    }
}

impl SystemStores for MemoryStores {
    fn read(&mut self, store: SourceStore, location: Location) -> Vec<PhysicalRead> {
        self.requested.push((store, location));
        match self.stores.remove(&(store, location)) {
            Some(Ok(memory)) => vec![PhysicalRead { physical_store: Some(".Default".into()), outcome: Outcome::Read, status: 0, store: Some(memory) }],
            Some(Err((outcome, status))) => vec![PhysicalRead { physical_store: None, outcome, status, store: None }],
            None => vec![PhysicalRead { physical_store: None, outcome: Outcome::Absent, status: 2, store: None }],
        }
    }

    fn disallowed_ctl(&mut self) -> CtlRead {
        self.ctl.take().unwrap_or(CtlRead::Absent)
    }

    fn disallowed_locations(&mut self) -> Vec<Location> {
        if self.disallowed_locations.is_empty() { Location::BUN.to_vec() } else { self.disallowed_locations.clone() }
    }
}

#[test]
fn effective_eku_is_the_intersection_of_extension_and_property() {
    let pki = Pki::new();
    let root = pki.root("eku-root", "root");
    let leaf = pki.issued("eku-leaf", &root, "server_client");
    let store = CertStore::memory().unwrap();
    let context = store.add_encoded(&leaf.der).unwrap();
    assert_eq!(effective_eku(&context), Eku::Oids { oids: vec![SERVER_AUTH.into(), CLIENT_AUTH.into()] });
    set_eku_property(&context, &[SERVER_AUTH, CODE_SIGNING]);
    assert_eq!(effective_eku(&context), Eku::Oids { oids: vec![SERVER_AUTH.into()] });
}

#[test]
fn an_empty_effective_usage_is_unrestricted_only_with_crypt_e_not_found() {
    let pki = Pki::new();
    let root = pki.root("usage-root", "root");
    let leaf = pki.issued("usage-leaf", &root, "server_client");
    let store = CertStore::memory().unwrap();
    // No extension and no property: cUsageIdentifier == 0 with CRYPT_E_NOT_FOUND.
    assert_eq!(effective_eku(&store.add_encoded(&root.der).unwrap()), Eku::Unrestricted);
    // An extension and a property with no common usage: cUsageIdentifier == 0 with last error 0.
    let context = store.add_encoded(&leaf.der).unwrap();
    set_eku_property(&context, &[CODE_SIGNING]);
    assert_eq!(effective_eku(&context), Eku::NoUsage);
}

#[test]
fn certificate_identities_match_openssl() {
    let pki = Pki::new();
    let root = pki.root("identity-root", "root");
    let store = CertStore::memory().unwrap();
    assert_eq!(store.add_encoded(&root.der).unwrap().identity(), Some(pki.identity(&root)));
}

// Certificate SHA-1 subject algorithm (design 4.2 item 2): an entry is the SHA-1 of a tested certificate's DER.
#[test]
fn a_synthetic_signed_sha1_ctl_names_certificates_by_thumbprint() {
    let pki = Pki::new();
    let signer = pki.root("ctl-signer", "signer");
    let listed = pki.root("ctl-listed", "root");
    let kept = pki.root("ctl-kept", "root");
    let thumbprint: Vec<u8> = (0..20).map(|index| u8::from_str_radix(&pki.identity(&listed).sha1[index * 2..index * 2 + 2], 16).unwrap()).collect();
    let ctl = pki.sign_ctl(&ctl_content(&[&thumbprint, &[0xab; 20]], SHA1), &signer);
    let output = collect(&mut ctl_stores(ctl, &[&listed, &kept]), &[]).unwrap();
    assert_eq!((output.ctl, output.complete, output.ctl_sha1), (CtlOutcome::Read, true, vec![pki.identity(&listed).sha1]));

    let wrong_length = pki.sign_ctl(&ctl_content(&[&thumbprint, &[0xab; 32]], SHA1), &signer);
    let output = collect(&mut ctl_stores(wrong_length, &[&listed]), &[]).unwrap();
    assert_eq!((output.ctl, output.complete, output.ctl_sha1), (CtlOutcome::UnsupportedEntryLength, false, vec![]));

    let sha256 = pki.sign_ctl(&ctl_content(&[&[0x22u8; 32]], "2.16.840.1.101.3.4.2.1"), &signer);
    let output = collect(&mut ctl_stores(sha256, &[&listed]), &[]).unwrap();
    assert_eq!((output.ctl, output.complete), (CtlOutcome::UnsupportedSubjectAlgorithm, false));
    assert_eq!(decode_disallowed_ctl(&[0x30, 0x03, 0x02, 0x01, 0x00]).err(), Some(CtlOutcome::Undecodable));
}

const SHA1: &str = "1.3.14.3.2.26";
const DISALLOWED_HASH: &str = "1.3.6.1.4.1.311.10.11.15";

/// A store set whose LOCAL_MACHINE ROOT holds `roots`, with `ctl` as the registry value.
fn ctl_stores(ctl: Vec<u8>, roots: &[&Cert]) -> MemoryStores {
    let (stores, _) = MemoryStores::default().with(SourceStore::Root, Location::LocalMachine, roots);
    MemoryStores { ctl: Some(CtlRead::Bytes(ctl)), ..stores }
}

// disallowedHash (design 4.2 item 2): a 16-byte entry is the MD5 of the public key octets (the subjectPublicKey
// BIT STRING contents) or, as add-only hardening, of the TBSCertificate; a 48-byte entry is the SHA-384 of the
// TBSCertificate. Entries come from OpenSSL over the test's own slices of the DER, independent of the helper.
#[test]
fn a_disallowed_hash_ctl_names_certificates_by_public_key_md5_or_to_be_signed_digest() {
    let pki = Pki::new();
    let signer = pki.root("dh-signer", "signer");
    let r = pki.root("dh-R", "root");
    let x = pki.issued_with("dh-X", &r, "intermediate", "-sha384");
    let b = pki.root("dh-B", "root");
    let k = pki.root("dh-K", "root");
    let spki = pki.root("dh-spki", "root");
    let kept = pki.root("dh-kept", "root");
    let entries = [
        pki.public_key_md5(&k),
        pki.public_key_md5(&b),
        pki.to_be_signed_digest(&x, "-sha384"),
        // Hardening: MD5 of the TBSCertificate of an ecdsa-with-SHA256 certificate, so no signature hash is involved.
        pki.to_be_signed_digest(&r, "-md5"),
        // The MD5 of the whole SubjectPublicKeyInfo is not the 16-byte form (r13 review B1) and must not match.
        pki.subject_public_key_info_md5(&spki),
        vec![0x5a; 16],
        vec![0x5a; 48],
    ];
    let entries: Vec<&[u8]> = entries.iter().map(Vec::as_slice).collect();
    let ctl = pki.sign_ctl(&ctl_content(&entries, DISALLOWED_HASH), &signer);
    let (mut stores, _) = ctl_stores(ctl, &[&r, &k, &spki, &kept]).with(SourceStore::Ca, Location::CurrentUser, &[&x]);

    let output = collect(&mut stores, &[&b.der]).unwrap();
    let mut matched = vec![pki.identity(&r).sha1, pki.identity(&x).sha1, pki.identity(&b).sha1, pki.identity(&k).sha1];
    matched.sort();
    assert_eq!((output.ctl, output.complete, output.ctl_sha1), (CtlOutcome::Read, true, matched));
}

#[test]
fn a_disallowed_hash_entry_of_another_length_makes_the_scan_incomplete() {
    let pki = Pki::new();
    let signer = pki.root("dh-length-signer", "signer");
    let k = pki.root("dh-length-K", "root");
    let listed = pki.public_key_md5(&k);
    for length in [20, 32, 64] {
        let ctl = pki.sign_ctl(&ctl_content(&[&listed, &vec![0x5a; length]], DISALLOWED_HASH), &signer);
        let output = collect(&mut ctl_stores(ctl, &[&k]), &[]).unwrap();
        assert_eq!((output.ctl, output.complete, output.ctl_sha1), (CtlOutcome::UnsupportedEntryLength, false, vec![]), "{length}-byte entry");
    }
}

// No digest depends on the signature algorithm (design 4.2 item 2), so a certificate whose signature algorithm no
// hash is registered for is still matched by its key and keeps the scan complete.
#[test]
fn a_certificate_whose_signature_algorithm_has_no_hash_keeps_the_scan_complete() {
    let pki = Pki::new();
    let signer = pki.root("dh-unknown-signer", "signer");
    let original = pki.root("dh-unknown", "root");
    let mut unknown = original.der.clone();
    // Rewrite the outer signatureAlgorithm, ecdsa-with-SHA256, to an OID no hash algorithm is registered for.
    let ecdsa_sha256 = [0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02];
    let at = unknown.windows(ecdsa_sha256.len()).rposition(|window| window == ecdsa_sha256).unwrap();
    unknown[at + ecdsa_sha256.len() - 1] = 0x7f;
    let ctl = pki.sign_ctl(&ctl_content(&[&pki.public_key_md5(&original)], DISALLOWED_HASH), &signer);
    let store = CertStore::memory().unwrap();
    let sha1 = store.add_encoded(&unknown).expect("Crypt32 stores the certificate without checking its signature").identity().unwrap().sha1;
    let mut stores = MemoryStores { ctl: Some(CtlRead::Bytes(ctl)), ..MemoryStores::default() };
    stores.stores.insert((SourceStore::Root, Location::CurrentUser), Ok(store));

    let output = collect(&mut stores, &[]).unwrap();
    assert_eq!((output.ctl, output.complete, output.ctl_sha1), (CtlOutcome::Read, true, vec![sha1]));
}

#[test]
fn intermediates_are_verified_on_the_exclusive_root_engine() {
    let pki = Pki::new();
    let r = pki.root("R", "root");
    let x = pki.issued("X", &r, "intermediate_server");
    let rb = pki.root("Rb", "root");
    let xb = pki.issued("Xb", &rb, "intermediate");
    let xe = pki.issued("Xe", &r, "intermediate");
    let rd = pki.root("Rd", "root");
    let xd = pki.issued("Xd", &rd, "intermediate");
    let orphan = pki.root("orphan-root", "root");
    let xo = pki.issued("Xo", &orphan, "intermediate");
    let (stores, roots) = MemoryStores::default().with(SourceStore::Root, Location::LocalMachine, &[&r, &rd]);
    let (mut stores, intermediates) = stores.with(SourceStore::Ca, Location::CurrentUser, &[&x, &xb, &xe, &xd, &xo]);
    set_eku_property(&intermediates[2], &[CLIENT_AUTH]);
    // The root program's disallowed date, before every synthetic certificate: an explicit distrust of Rd.
    let disallowed_since = 1u64;
    let since = windows_sys::Win32::Foundation::FILETIME { dwLowDateTime: disallowed_since as u32, dwHighDateTime: 0 };
    let blob = CRYPT_INTEGER_BLOB { cbData: std::mem::size_of_val(&since) as u32, pbData: &since as *const _ as *mut u8 };
    assert_ne!(unsafe { CertSetCertificateContextProperty(roots[1].as_ptr(), CERT_DISALLOWED_FILETIME_PROP_ID, 0, &blob as *const _ as _) }, 0);

    let output = collect(&mut stores, &[&rb.der]).unwrap();
    let chain_of = |cert: &Cert| -> Option<Chain> {
        output.certificates.iter().find(|fact| fact.der == cert.der).and_then(|fact| fact.chain.clone())
    };
    let id = |cert: &Cert| pki.identity(cert);
    assert_eq!(chain_of(&x), Some(Chain { anchor: Some(id(&r)), path: vec![id(&x), id(&r)], explicit_distrust: false }));
    assert_eq!(chain_of(&xb), Some(Chain { anchor: Some(id(&rb)), path: vec![id(&xb), id(&rb)], explicit_distrust: false }));
    let excluded = chain_of(&xe).unwrap();
    assert_eq!((excluded.anchor, excluded.explicit_distrust), (None, false));
    let distrusted = chain_of(&xd).unwrap();
    assert_eq!((distrusted.anchor, distrusted.explicit_distrust), (None, true));
    assert_eq!(chain_of(&xo).unwrap().anchor, None);
    assert_eq!(chain_of(&r), None, "a self-signed ROOT certificate is an anchor candidate, not an intermediate");
    assert_eq!(output.bundled_roots, vec![id(&rb)]);
    let root_fact = output.certificates.iter().find(|fact| fact.der == r.der).unwrap();
    assert_eq!((root_fact.self_signed, root_fact.ca, &root_fact.eku), (true, true, &Eku::Unrestricted));
    let x_fact = output.certificates.iter().find(|fact| fact.der == x.der).unwrap();
    assert_eq!((x_fact.self_signed, x_fact.ca, &x_fact.eku), (false, true, &Eku::Oids { oids: vec![SERVER_AUTH.into()] }));
    assert!(output.complete);
}

#[test]
fn store_outcomes_stay_distinct_and_unreadable_negatives_fail_closed() {
    let pki = Pki::new();
    let n = pki.root("N", "root");
    let (stores, _) = MemoryStores::default().with(SourceStore::Disallowed, Location::LocalMachine, &[&n]);
    let mut stores = stores
        .failing(SourceStore::Root, Location::CurrentUserGroupPolicy, Outcome::AccessDenied)
        .failing(SourceStore::Ca, Location::LocalMachineEnterprise, Outcome::EnumerationFailed);
    let output = collect(&mut stores, &[]).unwrap();
    assert!(output.complete, "positive-store failures and absent Disallowed stores keep the negative scan complete");
    let outcome = |store, location| {
        output.sources.iter().find(|source| source.store == store && source.location == location).map(|source| (source.outcome, source.status))
    };
    assert_eq!(outcome(SourceStore::Root, Location::CurrentUserGroupPolicy), Some((Outcome::AccessDenied, 5)));
    assert_eq!(outcome(SourceStore::Ca, Location::LocalMachineEnterprise), Some((Outcome::EnumerationFailed, 0x8009_2004)));
    assert_eq!(outcome(SourceStore::Disallowed, Location::CurrentUser), Some((Outcome::Absent, 2)));
    assert_eq!(outcome(SourceStore::Disallowed, Location::LocalMachine), Some((Outcome::Read, 0)));
    assert_eq!(output.disallowed.len(), 1);
    assert_eq!(output.disallowed[0].der, n.der);
    assert_eq!(output.ctl, CtlOutcome::Absent);
    assert!(!stores.requested.contains(&(SourceStore::TrustedPeople, Location::CurrentUser)), "current-user TrustedPeople is not read");
    assert!(stores.requested.contains(&(SourceStore::TrustedPeople, Location::LocalMachineEnterprise)));

    for outcome in [Outcome::AccessDenied, Outcome::EnumerationFailed] {
        let mut denied = MemoryStores::default().failing(SourceStore::Disallowed, Location::LocalMachineGroupPolicy, outcome);
        assert!(!collect(&mut denied, &[]).unwrap().complete, "{outcome:?}");
    }
    let mut unreadable = MemoryStores { ctl: Some(CtlRead::Unreadable), ..MemoryStores::default() };
    let output = collect(&mut unreadable, &[]).unwrap();
    assert_eq!((output.ctl, output.complete), (CtlOutcome::Unreadable, false));
    let mut garbage = MemoryStores { ctl: Some(CtlRead::Bytes(vec![0x30, 0x00])), ..MemoryStores::default() };
    let output = collect(&mut garbage, &[]).unwrap();
    assert_eq!((output.ctl, output.complete), (CtlOutcome::Undecodable, false));
    let mut service = MemoryStores {
        disallowed_locations: vec![Location::CurrentService, Location::UserSid],
        ..MemoryStores::default()
    }
    .failing(SourceStore::Disallowed, Location::UserSid, Outcome::AccessDenied);
    let output = collect(&mut service, &[]).unwrap();
    assert!(!output.complete);
    assert!(service.requested.contains(&(SourceStore::Disallowed, Location::CurrentService)));
}

#[test]
fn a_bundled_root_that_is_not_a_certificate_is_refused() {
    let mut stores = MemoryStores::default();
    assert_eq!(collect(&mut stores, &[&[0x30, 0x00]]).err(), Some(CollectError::BundledRoot));
}

/// Two long-standing certificates from Microsoft's public disallowedcert.sst; source URL and SHA-256 in
/// tests/fixtures/disallowedcert-sst/README.md. They are only hashed, never trusted.
const ENFORCED_LICENSING_PCA: &[u8] = include_bytes!("fixtures/disallowedcert-sst/microsoft-enforced-licensing-intermediate-pca.der");
const DARKMATTER_ASSURED_CA: &[u8] = include_bytes!("fixtures/disallowedcert-sst/darkmatter-assured-ca.der");

/// The CTL's sequence number as big-endian hex, so a list change can be told apart from a matcher bug.
fn ctl_sequence_number(ctl: &[u8]) -> String {
    unsafe {
        let context = CertCreateCTLContext(X509_ASN_ENCODING | PKCS_7_ASN_ENCODING, ctl.as_ptr(), ctl.len() as u32);
        if context.is_null() {
            return "undecodable".into();
        }
        let number = &(*(*context).pCtlInfo).SequenceNumber;
        let text = if number.cbData == 0 {
            "none".into()
        } else {
            std::slice::from_raw_parts(number.pbData, number.cbData as usize).iter().rev().map(|byte| format!("{byte:02x}")).collect()
        };
        CertFreeCTLContext(context);
        text
    }
}

// Design 4.2 item 2 proof obligation (9.2): the runner's real Disallowed CTL, read from the registry, names one public
// certificate of each disallowedHash form (16 bytes: MD5 of the public key octets; 48 bytes: SHA-384 of the
// TBSCertificate), and a synthetic control certificate matches nothing.
#[test]
fn the_runner_disallowed_ctl_names_public_disallowed_certificates_of_both_forms() {
    let CtlRead::Bytes(real) = System.disallowed_ctl() else { panic!("the runner has no readable DisallowedCertEncodedCtl registry value") };
    let sequence = ctl_sequence_number(&real);
    println!("runner Disallowed CTL: {} bytes, sequence number {sequence}", real.len());
    let pki = Pki::new();
    let control = pki.root("ctl-control", "root");
    let mut stores = MemoryStores { ctl: Some(CtlRead::Bytes(real)), ..MemoryStores::default() }
        .with_der(SourceStore::Ca, Location::LocalMachine, &[DARKMATTER_ASSURED_CA])
        .with_der(SourceStore::Root, Location::CurrentUser, &[&control.der]);

    let output = collect(&mut stores, &[ENFORCED_LICENSING_PCA]).unwrap();
    let fixtures = vec!["2a83e9020591a55fc6ddad3fb102794c52b24e70".to_owned(), "9feb091e053d1c453c789e8e9c446d31cb177ed9".to_owned()];
    assert_eq!(
        (output.ctl, output.complete, output.ctl_sha1),
        (CtlOutcome::Read, true, fixtures),
        "runner Disallowed CTL sequence number {sequence}; control SHA-1 {}",
        pki.identity(&control).sha1
    );
}
