//! Crypt32 facts (design 4.2), compiled only for Windows. Stores are opened read-only and existing-only under the helper's identity;
//! system-store enumeration sits behind `SystemStores` so the adapter tests run on in-memory stores.

use std::collections::{BTreeSet, HashSet};
use std::ffi::{c_void, CStr};
use std::ptr::{null, null_mut};

use windows_sys::core::{w, BOOL, PCWSTR, PSTR, PWSTR};
use windows_sys::Win32::Foundation::{
    CloseHandle, GetLastError, LocalFree, SetLastError, CRYPT_E_NOT_FOUND, ERROR_ACCESS_DENIED, ERROR_FILE_NOT_FOUND,
    ERROR_MORE_DATA, ERROR_NO_MORE_FILES, ERROR_PATH_NOT_FOUND, ERROR_SUCCESS, E_ACCESSDENIED, HANDLE, HLOCAL,
};
use windows_sys::Win32::Security::Authorization::ConvertSidToStringSidW;
use windows_sys::Win32::Security::Cryptography::*;
use windows_sys::Win32::Security::{
    CheckTokenMembership, CreateWellKnownSid, GetTokenInformation, TokenUser, WinServiceSid, TOKEN_QUERY, TOKEN_USER,
};
use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_BINARY};
use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken, TerminateProcess};

use crate::document::{hex, Chain, Identity, Outcome, EXIT_INTERNAL, EXIT_WATCHDOG, SCHEMA};
use crate::stdin::{read_bounded, split_der_list, STDIN_LIMIT};
use crate::watchdog;
use crate::windows_document::{
    emit, negatives_complete, CtlOutcome, DisallowedCertificate, Eku, Location, SourceStore, WindowsCertificate,
    WindowsDocument, WindowsSource, EXIT_BAD_STDIN,
};

const ENCODING: u32 = X509_ASN_ENCODING | PKCS_7_ASN_ENCODING;
/// The Disallowed CTL is tens of kilobytes; anything near this bound is not a CTL Windows wrote.
const CTL_LIMIT: u32 = 8 * 1024 * 1024;
/// szOID_OIWSEC_sha1: an entry is a certificate's SHA-1 thumbprint.
const SHA1_SUBJECT_ALGORITHM: &CStr = c"1.3.14.3.2.26";
/// szOID_DISALLOWED_HASH, the subject algorithm of Windows' own Disallowed CTL (design 4.2 item 2).
const DISALLOWED_HASH_SUBJECT_ALGORITHM: &CStr = c"1.3.6.1.4.1.311.10.11.15";

/// An open certificate store handle.
pub struct CertStore(HCERTSTORE);

impl CertStore {
    pub fn memory() -> Result<CertStore, u32> {
        let handle = unsafe { CertOpenStore(CERT_STORE_PROV_MEMORY, 0, 0, CERT_STORE_CREATE_NEW_FLAG, null()) };
        if handle.is_null() {
            return Err(unsafe { GetLastError() });
        }
        Ok(CertStore(handle))
    }

    /// Adds DER to the store and returns the store's own context, so properties set on it stay in the store.
    pub fn add_encoded(&self, der: &[u8]) -> Option<Context> {
        let length = u32::try_from(der.len()).ok()?;
        let mut added: *mut CERT_CONTEXT = null_mut();
        let ok = unsafe {
            CertAddEncodedCertificateToStore(self.0, X509_ASN_ENCODING, der.as_ptr(), length, CERT_STORE_ADD_USE_EXISTING, &mut added)
        };
        (ok != 0 && !added.is_null()).then(|| Context(added))
    }

    /// Copies a context with its properties (EKU and root-program properties included).
    fn add_context(&self, context: &Context) -> bool {
        unsafe { CertAddCertificateContextToStore(self.0, context.0, CERT_STORE_ADD_USE_EXISTING, null_mut()) != 0 }
    }

    /// Every certificate, or the error when enumeration ends with anything but the normal end.
    fn certificates(&self) -> Result<Vec<Context>, u32> {
        let mut out = Vec::new();
        let mut previous: *const CERT_CONTEXT = null();
        loop {
            let next = unsafe { CertEnumCertificatesInStore(self.0, previous) };
            if next.is_null() {
                let error = unsafe { GetLastError() };
                return if error == CRYPT_E_NOT_FOUND as u32 || error == ERROR_NO_MORE_FILES { Ok(out) } else { Err(error) };
            }
            out.push(Context(unsafe { CertDuplicateCertificateContext(next) }));
            previous = next;
        }
    }
}

impl Drop for CertStore {
    fn drop(&mut self) {
        unsafe { CertCloseStore(self.0, 0) };
    }
}

/// An owned certificate context reference.
pub struct Context(*const CERT_CONTEXT);

impl Context {
    pub fn as_ptr(&self) -> *const CERT_CONTEXT {
        self.0
    }

    fn der(&self) -> &[u8] {
        encoded(self.certificate())
    }

    fn certificate(&self) -> &CERT_CONTEXT {
        unsafe { &*self.0 }
    }

    fn info(&self) -> &CERT_INFO {
        unsafe { &*(*self.0).pCertInfo }
    }

    /// DER SHA-256 and SHA-1, hashed by Crypt32.
    pub fn identity(&self) -> Option<Identity> {
        identity_of(self.der())
    }
}

impl Drop for Context {
    fn drop(&mut self) {
        unsafe { CertFreeCertificateContext(self.0) };
    }
}

fn encoded(certificate: &CERT_CONTEXT) -> &[u8] {
    unsafe { std::slice::from_raw_parts(certificate.pbCertEncoded, certificate.cbCertEncoded as usize) }
}

fn digest(algorithm: PCWSTR, bytes: &[u8], size: usize) -> Option<Vec<u8>> {
    let mut out = vec![0u8; size];
    let mut length = size as u32;
    let ok = unsafe {
        CryptHashCertificate2(algorithm, 0, null(), bytes.as_ptr(), u32::try_from(bytes.len()).ok()?, out.as_mut_ptr(), &mut length)
    };
    (ok != 0 && length as usize == size).then_some(out)
}

fn identity_of(der: &[u8]) -> Option<Identity> {
    Some(Identity { sha256: hex(&digest(w!("SHA256"), der, 32)?), sha1: hex(&digest(w!("SHA1"), der, 20)?) })
}

/// The certificate's TBSCertificate exactly as encoded: `X509_CERT` decodes to `CERT_SIGNED_CONTENT_INFO`, whose
/// `ToBeSigned` is the raw encoded bytes taken from `der`, never a re-encoding.
fn to_be_signed(der: &[u8]) -> Option<Vec<u8>> {
    let mut decoded: *mut CERT_SIGNED_CONTENT_INFO = null_mut();
    let mut size = 0u32;
    let ok = unsafe {
        CryptDecodeObjectEx(
            X509_ASN_ENCODING,
            X509_CERT,
            der.as_ptr(),
            u32::try_from(der.len()).ok()?,
            CRYPT_DECODE_ALLOC_FLAG,
            null(),
            (&mut decoded as *mut *mut CERT_SIGNED_CONTENT_INFO).cast(),
            &mut size,
        )
    };
    if ok == 0 || decoded.is_null() {
        return None;
    }
    let blob = unsafe { &(*decoded).ToBeSigned };
    let bytes = (!blob.pbData.is_null() && blob.cbData > 0)
        .then(|| unsafe { std::slice::from_raw_parts(blob.pbData, blob.cbData as usize) }.to_vec());
    unsafe { LocalFree(decoded as HLOCAL) };
    bytes
}

/// Effective EKU through `CertGetEnhancedKeyUsage(context, 0, ...)` (design 4.2 item 4).
pub fn effective_eku(context: &Context) -> Eku {
    let mut size = 0u32;
    if unsafe { CertGetEnhancedKeyUsage(context.0, 0, null_mut(), &mut size) } == 0 || size == 0 {
        return Eku::Error;
    }
    // CTL_USAGE holds pointers, so the buffer is pointer aligned.
    let mut buffer = vec![0usize; (size as usize).div_ceil(std::mem::size_of::<usize>())];
    unsafe { SetLastError(ERROR_SUCCESS) };
    let ok = unsafe { CertGetEnhancedKeyUsage(context.0, 0, buffer.as_mut_ptr().cast(), &mut size) };
    let error = unsafe { GetLastError() };
    if ok == 0 {
        return Eku::Error;
    }
    let usage = unsafe { &*buffer.as_ptr().cast::<CTL_USAGE>() };
    if usage.cUsageIdentifier == 0 {
        return match error {
            error if error == CRYPT_E_NOT_FOUND as u32 => Eku::Unrestricted,
            ERROR_SUCCESS => Eku::NoUsage,
            _ => Eku::Error,
        };
    }
    let identifiers = unsafe { std::slice::from_raw_parts(usage.rgpszUsageIdentifier, usage.cUsageIdentifier as usize) };
    let mut oids = Vec::with_capacity(identifiers.len());
    for identifier in identifiers {
        match unsafe { CStr::from_ptr(identifier.cast_const().cast()) }.to_str() {
            Ok(oid) if is_oid(oid) => oids.push(oid.to_owned()),
            _ => return Eku::Error,
        }
    }
    Eku::Oids { oids }
}

fn is_oid(text: &str) -> bool {
    let arcs: Vec<&str> = text.split('.').collect();
    arcs.len() >= 2
        && matches!(arcs[0], "0" | "1" | "2")
        && arcs.iter().all(|arc| !arc.is_empty() && arc.bytes().all(|byte| byte.is_ascii_digit()) && (arc.len() == 1 || !arc.starts_with('0')))
}

/// Issuer equals subject and the certificate's own key verifies its signature.
fn is_self_signed(context: &Context) -> bool {
    let info = context.info();
    unsafe {
        CertCompareCertificateName(X509_ASN_ENCODING, &info.Subject, &info.Issuer) != 0
            && CryptVerifyCertificateSignatureEx(
                0,
                X509_ASN_ENCODING,
                CRYPT_VERIFY_CERT_SIGN_SUBJECT_CERT,
                context.0.cast(),
                CRYPT_VERIFY_CERT_SIGN_ISSUER_CERT,
                context.0.cast(),
                0,
                null_mut(),
            ) != 0
    }
}

/// Basic constraints with cA set; an absent or undecodable extension is not a CA.
fn is_ca(context: &Context) -> bool {
    let info = context.info();
    let extension = unsafe { CertFindExtension(szOID_BASIC_CONSTRAINTS2, info.cExtension, info.rgExtension) };
    if extension.is_null() {
        return false;
    }
    let value = unsafe { &(*extension).Value };
    let mut decoded = CERT_BASIC_CONSTRAINTS2_INFO { fCA: 0, fPathLenConstraint: 0, dwPathLenConstraint: 0 };
    let mut size = std::mem::size_of::<CERT_BASIC_CONSTRAINTS2_INFO>() as u32;
    let ok = unsafe {
        CryptDecodeObjectEx(X509_ASN_ENCODING, X509_BASIC_CONSTRAINTS2, value.pbData, value.cbData, 0, null(), (&mut decoded as *mut CERT_BASIC_CONSTRAINTS2_INFO).cast(), &mut size)
    };
    ok != 0 && decoded.fCA != 0
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SubjectAlgorithm {
    CertificateSha1,
    DisallowedHash,
}

/// A decoded Disallowed CTL: the subject algorithm it declares and its entries. Matching is the importer's own
/// (design 4.2 item 2, revision 13): Crypt32's `CertFindSubjectInCTL` refuses disallowedHash with `NTE_BAD_ALGID`.
pub struct DisallowedCtl {
    algorithm: SubjectAlgorithm,
    entries: HashSet<Vec<u8>>,
}

impl DisallowedCtl {
    /// Whether an entry names the certificate, or None when a digest could not be computed. Every digest is over
    /// bytes of the certificate as presented; none depends on its signature algorithm.
    fn names(&self, certificate: &CERT_CONTEXT) -> Option<bool> {
        let der = encoded(certificate);
        let digests = match self.algorithm {
            SubjectAlgorithm::CertificateSha1 => vec![digest(w!("SHA1"), der, 20)?],
            SubjectAlgorithm::DisallowedHash => {
                // CryptoAPI `PublicKey.pbData`: the subjectPublicKey BIT STRING contents after the unused-bits byte.
                let key = &unsafe { certificate.pCertInfo.as_ref() }?.SubjectPublicKeyInfo.PublicKey;
                let key = if key.cbData == 0 { &[][..] } else { unsafe { std::slice::from_raw_parts(key.pbData, key.cbData as usize) } };
                let to_be_signed = to_be_signed(der)?;
                vec![
                    digest(w!("MD5"), key, 16)?,
                    digest(w!("SHA384"), &to_be_signed, 48)?,
                    // Hardening that can only add to D: a 16-byte entry is also compared with MD5(TBSCertificate).
                    digest(w!("MD5"), &to_be_signed, 16)?,
                ]
            }
        };
        Some(digests.iter().any(|digest| self.entries.contains(digest)))
    }
}

/// Decodes the Disallowed CTL with `CertCreateCTLContext`. The signature is not verified: the CTL can only
/// remove trust. The scan is incomplete, never partial, when the CTL declares no subject algorithm or one other
/// than certificate SHA-1 and disallowedHash, or when an entry has a length that algorithm does not define:
/// certificate SHA-1 entries are 20 bytes, disallowedHash entries 16 or 48 (design 4.2 item 2).
pub fn decode_disallowed_ctl(bytes: &[u8]) -> Result<DisallowedCtl, CtlOutcome> {
    let length = u32::try_from(bytes.len()).map_err(|_| CtlOutcome::Undecodable)?;
    let ctl = unsafe { CertCreateCTLContext(ENCODING, bytes.as_ptr(), length) };
    if ctl.is_null() {
        return Err(CtlOutcome::Undecodable);
    }
    let result = (|| {
        let info = unsafe { (*ctl).pCtlInfo.as_ref() }.ok_or(CtlOutcome::Undecodable)?;
        let algorithm = info.SubjectAlgorithm.pszObjId;
        if algorithm.is_null() {
            return Err(CtlOutcome::UnsupportedSubjectAlgorithm);
        }
        let algorithm = unsafe { CStr::from_ptr(algorithm.cast_const().cast()) };
        let (algorithm, lengths): (SubjectAlgorithm, &[usize]) = if algorithm == SHA1_SUBJECT_ALGORITHM {
            (SubjectAlgorithm::CertificateSha1, &[20])
        } else if algorithm == DISALLOWED_HASH_SUBJECT_ALGORITHM {
            (SubjectAlgorithm::DisallowedHash, &[16, 48])
        } else {
            return Err(CtlOutcome::UnsupportedSubjectAlgorithm);
        };
        let entries: &[CTL_ENTRY] =
            if info.cCTLEntry == 0 { &[] } else { unsafe { std::slice::from_raw_parts(info.rgCTLEntry, info.cCTLEntry as usize) } };
        let mut out = HashSet::with_capacity(entries.len());
        for entry in entries {
            let subject = &entry.SubjectIdentifier;
            if subject.pbData.is_null() || !lengths.contains(&(subject.cbData as usize)) {
                return Err(CtlOutcome::UnsupportedEntryLength);
            }
            out.insert(unsafe { std::slice::from_raw_parts(subject.pbData, subject.cbData as usize) }.to_vec());
        }
        Ok(DisallowedCtl { algorithm, entries: out })
    })();
    unsafe { CertFreeCTLContext(ctl) };
    result
}

/// Applies the Disallowed CTL to every certificate the policy might use: `B`, every positive candidate and every
/// chain element. A hit is reported by the certificate's SHA-1, which the policy puts into `D`. A certificate that
/// cannot be digested fails the whole collection, so `D` is never partial.
#[derive(Default)]
struct CtlMatch {
    ctl: Option<DisallowedCtl>,
    matched: BTreeSet<String>,
    failed: bool,
}

impl CtlMatch {
    fn check(&mut self, certificate: &CERT_CONTEXT) {
        let Some(ctl) = &self.ctl else { return };
        match ctl.names(certificate) {
            Some(false) => {}
            Some(true) => match identity_of(encoded(certificate)) {
                Some(identity) => {
                    self.matched.insert(identity.sha1);
                }
                None => self.failed = true,
            },
            None => self.failed = true,
        }
    }
}

/// One physical store of a system store, or the outcome for a system store that could not be listed.
pub struct PhysicalRead {
    pub physical_store: Option<String>,
    pub outcome: Outcome,
    /// The Win32 error behind the outcome; 0 when read.
    pub status: u32,
    /// Present only when `outcome` is `Read`; enumeration can still fail.
    pub store: Option<CertStore>,
}

pub enum CtlRead {
    Absent,
    Unreadable,
    Bytes(Vec<u8>),
}

/// The injected system-store interface (design 9.2).
pub trait SystemStores {
    fn read(&mut self, store: SourceStore, location: Location) -> Vec<PhysicalRead>;
    fn disallowed_ctl(&mut self) -> CtlRead;
    /// Every `Disallowed` location applicable to this process's identity.
    fn disallowed_locations(&mut self) -> Vec<Location>;
}

#[derive(Debug, PartialEq, Eq)]
pub enum CollectError {
    /// A `B` entry Crypt32 cannot parse as a certificate.
    BundledRoot,
    Internal,
}

struct Candidate {
    context: Context,
    store: SourceStore,
    location: Location,
    physical_store: String,
}

fn read_store<S: SystemStores>(
    stores: &mut S,
    store: SourceStore,
    location: Location,
    sources: &mut Vec<WindowsSource>,
) -> Vec<(Context, String)> {
    let mut out = Vec::new();
    for read in stores.read(store, location) {
        let (mut outcome, mut status) = (read.outcome, read.status);
        if let (Outcome::Read, Some(handle)) = (outcome, &read.store) {
            match handle.certificates() {
                Ok(contexts) => {
                    let name = read.physical_store.clone().unwrap_or_default();
                    out.extend(contexts.into_iter().map(|context| (context, name.clone())));
                }
                Err(error) => (outcome, status) = (Outcome::EnumerationFailed, error),
            }
        }
        sources.push(WindowsSource { store, location, physical_store: read.physical_store, outcome, status });
    }
    out
}

/// Collects every fact of design 4.1 for Windows. `bundled` is Bun's `B`, one DER certificate per entry.
pub fn collect<S: SystemStores>(stores: &mut S, bundled: &[&[u8]]) -> Result<WindowsDocument, CollectError> {
    let roots = CertStore::memory().map_err(|_| CollectError::Internal)?;
    let others = CertStore::memory().map_err(|_| CollectError::Internal)?;
    let mut bundled_roots = Vec::with_capacity(bundled.len());
    let mut bundled_contexts = Vec::with_capacity(bundled.len());
    for der in bundled {
        let context = roots.add_encoded(der).ok_or(CollectError::BundledRoot)?;
        bundled_roots.push(context.identity().ok_or(CollectError::Internal)?);
        bundled_contexts.push(context);
    }
    let (ctl, mut matcher) = match stores.disallowed_ctl() {
        CtlRead::Absent => (CtlOutcome::Absent, CtlMatch::default()),
        CtlRead::Unreadable => (CtlOutcome::Unreadable, CtlMatch::default()),
        CtlRead::Bytes(bytes) => match decode_disallowed_ctl(&bytes) {
            Ok(decoded) => (CtlOutcome::Read, CtlMatch { ctl: Some(decoded), ..CtlMatch::default() }),
            Err(outcome) => (outcome, CtlMatch::default()),
        },
    };
    for context in &bundled_contexts {
        matcher.check(context.certificate());
    }

    let mut sources = Vec::new();
    let mut candidates = Vec::new();
    let positive = [
        (SourceStore::Root, &Location::BUN[..]),
        (SourceStore::Ca, &Location::BUN[..]),
        (SourceStore::TrustedPeople, &Location::MACHINE[..]),
    ];
    for (store, locations) in positive {
        for &location in locations {
            for (context, physical_store) in read_store(stores, store, location, &mut sources) {
                candidates.push(Candidate { context, store, location, physical_store });
            }
        }
    }
    let mut disallowed = Vec::new();
    for location in stores.disallowed_locations() {
        for (context, physical_store) in read_store(stores, SourceStore::Disallowed, location, &mut sources) {
            disallowed.push(DisallowedCertificate { der: context.der().to_vec(), location, physical_store });
        }
    }

    // Root candidates plus B are the exclusive anchors; every positive candidate can help build a path.
    for candidate in &candidates {
        let added = if candidate.store == SourceStore::Root { roots.add_context(&candidate.context) } else { true };
        if !added || !others.add_context(&candidate.context) {
            return Err(CollectError::Internal);
        }
    }
    let engine = ChainEngine::exclusive(&roots).ok_or(CollectError::Internal)?;

    let certificates: Vec<WindowsCertificate> = candidates
        .iter()
        .map(|candidate| {
            matcher.check(candidate.context.certificate());
            let self_signed = is_self_signed(&candidate.context);
            let ca = is_ca(&candidate.context);
            let intermediate = match candidate.store {
                SourceStore::Ca => true,
                SourceStore::Root => !self_signed,
                SourceStore::TrustedPeople => !self_signed && ca,
                SourceStore::Disallowed => false,
            };
            WindowsCertificate {
                der: candidate.context.der().to_vec(),
                store: candidate.store,
                location: candidate.location,
                physical_store: candidate.physical_store.clone(),
                self_signed,
                ca,
                eku: effective_eku(&candidate.context),
                chain: if intermediate { engine.verify(&candidate.context, &others, &mut matcher) } else { None },
            }
        })
        .collect();
    if matcher.failed {
        return Err(CollectError::Internal);
    }
    let ctl_sha1 = matcher.matched.into_iter().collect();

    Ok(WindowsDocument {
        schema: SCHEMA,
        os: "windows",
        complete: negatives_complete(&sources, ctl),
        sources,
        ctl,
        certificates,
        disallowed,
        ctl_sha1,
        bundled_roots,
    })
}

struct ChainEngine(HCERTCHAINENGINE);

impl ChainEngine {
    /// `hExclusiveRoot` holds the anchors; URL retrieval is cache-only (design 4.2 item 5).
    fn exclusive(roots: &CertStore) -> Option<ChainEngine> {
        let mut config: CERT_CHAIN_ENGINE_CONFIG = unsafe { std::mem::zeroed() };
        config.cbSize = std::mem::size_of::<CERT_CHAIN_ENGINE_CONFIG>() as u32;
        config.hExclusiveRoot = roots.0;
        config.dwFlags = CERT_CHAIN_CACHE_ONLY_URL_RETRIEVAL;
        let mut engine: HCERTCHAINENGINE = null_mut();
        (unsafe { CertCreateCertificateChainEngine(&config, &mut engine) } != 0).then_some(ChainEngine(engine))
    }

    /// The SSL-policy verdict for server authentication with no server name, ignoring revocation-unknown.
    fn verify(&self, context: &Context, others: &CertStore, ctl: &mut CtlMatch) -> Option<Chain> {
        let mut server_auth = *b"1.3.6.1.5.5.7.3.1\0";
        let mut usages: [PSTR; 1] = [server_auth.as_mut_ptr()];
        let mut para: CERT_CHAIN_PARA = unsafe { std::mem::zeroed() };
        para.cbSize = std::mem::size_of::<CERT_CHAIN_PARA>() as u32;
        para.RequestedUsage = CERT_USAGE_MATCH {
            dwType: USAGE_MATCH_TYPE_AND,
            Usage: CTL_USAGE { cUsageIdentifier: 1, rgpszUsageIdentifier: usages.as_mut_ptr() },
        };
        let flags = CERT_CHAIN_CACHE_ONLY_URL_RETRIEVAL | CERT_CHAIN_DISABLE_AUTH_ROOT_AUTO_UPDATE;
        let mut chain: *mut CERT_CHAIN_CONTEXT = null_mut();
        if unsafe { CertGetCertificateChain(self.0, context.0, null(), others.0, &para, flags, null(), &mut chain) } == 0
            || chain.is_null()
        {
            return None;
        }
        let result = (|| {
            let summary = unsafe { &*chain };
            let explicit_distrust = summary.TrustStatus.dwErrorStatus & CERT_TRUST_IS_EXPLICIT_DISTRUST != 0;
            if summary.cChain == 0 {
                return None;
            }
            let simple = unsafe { &**summary.rgpChain };
            let elements = unsafe { std::slice::from_raw_parts(simple.rgpElement, simple.cElement as usize) };
            let path = elements
                .iter()
                .map(|element| {
                    let certificate = unsafe { &*(**element).pCertContext };
                    ctl.check(certificate);
                    identity_of(encoded(certificate))
                })
                .collect::<Option<Vec<Identity>>>()?;
            let mut https: HTTPSPolicyCallbackData = unsafe { std::mem::zeroed() };
            https.Anonymous.cbStruct = std::mem::size_of::<HTTPSPolicyCallbackData>() as u32;
            https.dwAuthType = AUTHTYPE_SERVER;
            let policy = CERT_CHAIN_POLICY_PARA {
                cbSize: std::mem::size_of::<CERT_CHAIN_POLICY_PARA>() as u32,
                dwFlags: CERT_CHAIN_POLICY_IGNORE_ALL_REV_UNKNOWN_FLAGS,
                pvExtraPolicyPara: (&mut https as *mut HTTPSPolicyCallbackData).cast(),
            };
            let mut status: CERT_CHAIN_POLICY_STATUS = unsafe { std::mem::zeroed() };
            status.cbSize = std::mem::size_of::<CERT_CHAIN_POLICY_STATUS>() as u32;
            let passed = unsafe { CertVerifyCertificateChainPolicy(CERT_CHAIN_POLICY_SSL, chain, &policy, &mut status) } != 0
                && status.dwError == 0
                && !explicit_distrust;
            let anchor = if passed { path.last().cloned() } else { None };
            Some(Chain { anchor, path, explicit_distrust })
        })();
        unsafe { CertFreeCertificateChain(chain) };
        result
    }
}

impl Drop for ChainEngine {
    fn drop(&mut self) {
        unsafe { CertFreeCertificateChainEngine(self.0) };
    }
}

/// The real system stores, read under the helper's own identity.
pub struct System;

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

fn outcome_of(error: u32) -> Outcome {
    const HRESULT_FILE_NOT_FOUND: u32 = 0x8007_0002;
    const HRESULT_PATH_NOT_FOUND: u32 = 0x8007_0003;
    match error {
        ERROR_FILE_NOT_FOUND | ERROR_PATH_NOT_FOUND | HRESULT_FILE_NOT_FOUND | HRESULT_PATH_NOT_FOUND => Outcome::Absent,
        ERROR_ACCESS_DENIED => Outcome::AccessDenied,
        error if error == E_ACCESSDENIED as u32 => Outcome::AccessDenied,
        _ => Outcome::EnumerationFailed,
    }
}

fn failed(status: u32) -> Vec<PhysicalRead> {
    vec![PhysicalRead { physical_store: None, outcome: outcome_of(status), status, store: None }]
}

impl System {
    /// The registry location flag and the system store name, with the alias prefix where one applies.
    fn system_store(store: SourceStore, location: Location) -> Option<(u32, String)> {
        let name = match store {
            SourceStore::Root => "ROOT",
            SourceStore::Ca => "CA",
            SourceStore::TrustedPeople => "TrustedPeople",
            SourceStore::Disallowed => "Disallowed",
        };
        let shift = |id: u32| id << CERT_SYSTEM_STORE_LOCATION_SHIFT;
        Some(match location {
            Location::CurrentUser => (shift(CERT_SYSTEM_STORE_CURRENT_USER_ID), name.to_owned()),
            Location::LocalMachine => (shift(CERT_SYSTEM_STORE_LOCAL_MACHINE_ID), name.to_owned()),
            Location::CurrentUserGroupPolicy => (shift(CERT_SYSTEM_STORE_CURRENT_USER_GROUP_POLICY_ID), name.to_owned()),
            Location::LocalMachineGroupPolicy => (shift(CERT_SYSTEM_STORE_LOCAL_MACHINE_GROUP_POLICY_ID), name.to_owned()),
            Location::LocalMachineEnterprise => (shift(CERT_SYSTEM_STORE_LOCAL_MACHINE_ENTERPRISE_ID), name.to_owned()),
            Location::CurrentService => (shift(CERT_SYSTEM_STORE_CURRENT_SERVICE_ID), name.to_owned()),
            Location::UserSid => (shift(CERT_SYSTEM_STORE_USERS_ID), format!("{}\\{name}", user_sid()?)),
            // The current service's alias names the same registry key as CURRENT_SERVICE, which is read instead.
            Location::ServiceSid => return None,
        })
    }
}

unsafe extern "system" fn on_physical_store(
    _system_store: *const c_void,
    _flags: u32,
    name: PCWSTR,
    info: *const CERT_PHYSICAL_STORE_INFO,
    _reserved: *const c_void,
    found: *mut c_void,
) -> BOOL {
    let found = unsafe { &mut *found.cast::<Vec<(String, bool)>>() };
    let length = (0..).take_while(|&index| unsafe { *name.add(index) } != 0).count();
    let name = String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(name, length) });
    let disabled = !info.is_null() && unsafe { (*info).dwFlags } & CERT_PHYSICAL_STORE_OPEN_DISABLE_FLAG != 0;
    found.push((name, disabled));
    1
}

impl SystemStores for System {
    fn read(&mut self, store: SourceStore, location: Location) -> Vec<PhysicalRead> {
        let Some((flags, name)) = Self::system_store(store, location) else {
            return vec![PhysicalRead { physical_store: None, outcome: Outcome::EnumerationFailed, status: 0, store: None }];
        };
        let open = |provider, name: &[u16]| unsafe {
            CertOpenStore(provider, 0, 0, flags | CERT_STORE_OPEN_EXISTING_FLAG | CERT_STORE_READONLY_FLAG, name.as_ptr().cast())
        };
        // The system store itself first: absent, denied and failed are distinct before any physical store.
        let system = open(CERT_STORE_PROV_SYSTEM_W, &wide(&name));
        if system.is_null() {
            return failed(unsafe { GetLastError() });
        }
        drop(CertStore(system));
        let mut physical: Vec<(String, bool)> = Vec::new();
        let listed = unsafe {
            CertEnumPhysicalStore(wide(&name).as_ptr().cast(), flags, (&mut physical as *mut Vec<(String, bool)>).cast(), Some(on_physical_store))
        };
        if listed == 0 {
            return failed(unsafe { GetLastError() });
        }
        // An open-disabled physical store is not part of the system store, so it is neither read nor reported.
        physical
            .into_iter()
            .filter(|(_, disabled)| !disabled)
            .map(|(physical_name, _)| {
                let handle = open(CERT_STORE_PROV_PHYSICAL_W, &wide(&format!("{name}\\{physical_name}")));
                if handle.is_null() {
                    let status = unsafe { GetLastError() };
                    return PhysicalRead { physical_store: Some(physical_name), outcome: outcome_of(status), status, store: None };
                }
                PhysicalRead { physical_store: Some(physical_name), outcome: Outcome::Read, status: 0, store: Some(CertStore(handle)) }
            })
            .collect()
    }

    fn disallowed_ctl(&mut self) -> CtlRead {
        let key = w!("SOFTWARE\\Microsoft\\SystemCertificates\\AuthRoot\\AutoUpdate");
        let value = w!("DisallowedCertEncodedCtl");
        // The value can grow between the size query and the read; retry a bounded number of times.
        for _ in 0..3 {
            let mut size = 0u32;
            match unsafe { RegGetValueW(HKEY_LOCAL_MACHINE, key, value, RRF_RT_REG_BINARY, null_mut(), null_mut(), &mut size) } {
                ERROR_SUCCESS => {}
                ERROR_FILE_NOT_FOUND => return CtlRead::Absent,
                _ => return CtlRead::Unreadable,
            }
            if size > CTL_LIMIT {
                return CtlRead::Unreadable;
            }
            let mut bytes = vec![0u8; size as usize];
            match unsafe { RegGetValueW(HKEY_LOCAL_MACHINE, key, value, RRF_RT_REG_BINARY, null_mut(), bytes.as_mut_ptr().cast(), &mut size) } {
                ERROR_SUCCESS => {
                    bytes.truncate(size as usize);
                    return CtlRead::Bytes(bytes);
                }
                ERROR_MORE_DATA => continue,
                ERROR_FILE_NOT_FOUND => return CtlRead::Absent,
                _ => return CtlRead::Unreadable,
            }
        }
        CtlRead::Unreadable
    }

    fn disallowed_locations(&mut self) -> Vec<Location> {
        let mut locations = Location::BUN.to_vec();
        locations.push(Location::UserSid);
        // When membership cannot be determined the store is read anyway; a failed open then fails closed.
        if is_service() != Some(false) {
            locations.push(Location::CurrentService);
        }
        locations
    }
}

/// The process user's SID string, for the user-SID alias of its own stores.
fn user_sid() -> Option<String> {
    unsafe {
        let mut token: HANDLE = null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return None;
        }
        let mut size = 0u32;
        GetTokenInformation(token, TokenUser, null_mut(), 0, &mut size);
        let mut buffer = vec![0usize; (size as usize).div_ceil(std::mem::size_of::<usize>())];
        let ok = GetTokenInformation(token, TokenUser, buffer.as_mut_ptr().cast(), size, &mut size);
        CloseHandle(token);
        if ok == 0 {
            return None;
        }
        let user = &*buffer.as_ptr().cast::<TOKEN_USER>();
        let mut text: PWSTR = null_mut();
        if ConvertSidToStringSidW(user.User.Sid, &mut text) == 0 {
            return None;
        }
        let length = (0..).take_while(|&index| *text.add(index) != 0).count();
        let sid = String::from_utf16(std::slice::from_raw_parts(text, length)).ok();
        LocalFree(text as HLOCAL);
        sid
    }
}

/// Whether the process runs as a service, so the current-service store applies (design 4.2 item 2).
fn is_service() -> Option<bool> {
    unsafe {
        let mut sid = [0u8; 68];
        let mut size = sid.len() as u32;
        if CreateWellKnownSid(WinServiceSid, null_mut(), sid.as_mut_ptr().cast(), &mut size) == 0 {
            return None;
        }
        let mut member: BOOL = 0;
        (CheckTokenMembership(null_mut(), sid.as_mut_ptr().cast(), &mut member) != 0).then_some(member != 0)
    }
}

/// The Windows helper process: stdin is Bun's bundled roots as concatenated DER (design 4.2 item 5).
pub fn run() -> i32 {
    watchdog::arm(
        || std::thread::sleep(watchdog::HARD_CAP),
        // TerminateProcess: no DLL detach or atexit work while another thread may be inside Crypt32.
        || unsafe {
            TerminateProcess(GetCurrentProcess(), EXIT_WATCHDOG as u32);
        },
    );
    let Ok(input) = read_bounded(&mut std::io::stdin().lock(), STDIN_LIMIT) else {
        return EXIT_BAD_STDIN;
    };
    let Ok(bundled) = split_der_list(&input) else {
        return EXIT_BAD_STDIN;
    };
    match collect(&mut System, &bundled) {
        Ok(document) => emit(&document),
        Err(CollectError::BundledRoot) => EXIT_BAD_STDIN,
        Err(CollectError::Internal) => EXIT_INTERNAL,
    }
}
