//! The live host's view for an engine the host did not spawn (DESIGN-GAPS-ROW28 revision 2,
//! G1, bound by R70k): the persisted `host-latch` file first, then `hand.status` over the
//! host's local API, read the asymmetric way - any reply may TIGHTEN the run, only a listener
//! that passed identity may LOOSEN it, and everything unanswered or unverifiable reads as latch
//! SET. No new reason and no new code: a set latch is `Suspended{host_latch}`, nothing sent.

#[cfg(unix)]
mod dial;
#[cfg(unix)]
mod files;
#[cfg(unix)]
mod identity;

use omo_computer_core::backend::Refusal;
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::host_paths::{self, HostPaths};
use serde_json::{json, Value};

#[cfg(unix)]
pub use files::read_consent;
#[cfg(unix)]
use identity::Identity;

use crate::router::WireError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LatchOutcome {
    /// Latched; `audit` names why when the reason is an attack signal or a disagreement.
    Set { audit: Option<String> },
    /// A verified host answered unlatched.
    Clear { fingerprint: String },
    /// No live host and no set latch file: the stated residual (d-test-qa.md row 29).
    FileOnly,
}

impl LatchOutcome {
    #[must_use]
    pub const fn is_set(&self) -> bool {
        matches!(self, Self::Set { .. })
    }
}

/// `capabilities().consent.authority`: `host` only after the listener's identity passed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Authority {
    Host,
    FileOnly,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostView {
    pub latch: LatchOutcome,
    pub authority: Authority,
}

pub struct HostLatch;

impl HostLatch {
    /// `Suspended{reason:"host_latch"}` with `nothingSent:true`, the session's own row.
    #[must_use]
    pub fn refusal() -> WireError {
        let mut error = crate::router::refused(&Refusal::new(EngineCode::Suspended, Reason::HostLatch));
        if let Some(data) = error.data.as_mut() {
            data["nothingSent"] = json!(true);
        }
        error
    }
}

fn set(audit: Option<String>) -> HostView {
    HostView {
        latch: LatchOutcome::Set { audit },
        authority: Authority::FileOnly,
    }
}

/// The host paths for this engine's environment; `fake` says the backend is the fake.
///
/// # Errors
/// Why no path is named, as the audit text of a latch SET.
pub fn host_paths(lookup: impl Fn(&str) -> Option<String>, fake: bool) -> Result<HostPaths, String> {
    host_paths::resolve(&lookup, fake, uid()).map_err(|why| format!("host_paths_unavailable:{why:?}"))
}

#[cfg(unix)]
fn uid() -> u32 {
    files::euid()
}

#[cfg(not(unix))]
const fn uid() -> u32 {
    0
}

/// The host view for this engine's environment; `fake` says the backend is the fake.
#[must_use]
pub fn read_host_view(lookup: impl Fn(&str) -> Option<String>, fake: bool) -> HostView {
    match host_paths(lookup, fake) {
        Ok(paths) => read(&paths, fake),
        Err(why) => set(Some(why)),
    }
}

/// Windows reads its host through the published pipe (row 60, owed): an endpoint file means a
/// host may be live and cannot be identified yet, which is latch SET; none is `file_only`.
#[cfg(not(unix))]
fn read(paths: &HostPaths, _fake: bool) -> HostView {
    match &paths.address {
        host_paths::HostAddress::Endpoint(file) if file.exists() => set(Some("host_api_windows_leg_owed".to_owned())),
        _ => HostView {
            latch: LatchOutcome::FileOnly,
            authority: Authority::FileOnly,
        },
    }
}

#[cfg(unix)]
fn read(paths: &HostPaths, fake: bool) -> HostView {
    let latch_file = files::read_latch(paths);
    if let files::LatchFile::Set | files::LatchFile::Unreadable(_) = latch_file {
        return set(latch_file.audit());
    }
    let identity = identity::checker(paths, fake);
    match dial::dial(&paths.address, identity.as_ref()) {
        dial::Dialed::NoListener => HostView {
            latch: LatchOutcome::FileOnly,
            authority: Authority::FileOnly,
        },
        dial::Dialed::Unanswered(why) => set(Some(why)),
        dial::Dialed::Answered { identity, reply } => from_reply(identity, &reply),
    }
}

#[cfg(unix)]
fn from_reply(identity: Identity, reply: &Value) -> HostView {
    let suspended = reply["latch"]["suspended"].as_bool();
    match (identity, suspended) {
        (_, Some(true)) => set(None),
        (Identity::Passed, Some(false)) => HostView {
            latch: LatchOutcome::Clear {
                fingerprint: reply["consentFingerprint"].as_str().unwrap_or_default().to_owned(),
            },
            authority: Authority::Host,
        },
        (Identity::Passed, None) => set(Some("host_reply_unparsed".to_owned())),
        (other, _) => set(Some(format!("host_api_identity_{other:?}"))),
    }
}

#[cfg(all(test, unix))]
mod tests;
