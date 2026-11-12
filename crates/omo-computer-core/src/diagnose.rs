//! `desktop.diagnose` (acceptance 57; design row G11): the readiness report `omo doctor computer`
//! prints. It READS - the permission probe and the capabilities' live session, stop path and
//! release helper from the backend; the spawn chain, responsible process and identity from the
//! host - and never prompts: no permission is requested, so a denied account diagnoses with a
//! pointer to its settings pane instead of a dialog. Every permission is
//! `Granted | Denied | Unknown`; the report is `ok` only when each is granted and the identity
//! matches.

use std::collections::BTreeMap;

use crate::backend::Backend;
use crate::results::{
    AttachVia, ChainLink, ConsentAuthority, Diagnosis, IdentityMatch, IdentityReport,
    PermissionReport, PermissionState,
};
use crate::untrusted::UntrustedText;

/// What only the host can read: its own spawn chain and identity.
#[derive(Debug, Clone)]
pub struct HostFacts {
    pub chain: Vec<ChainLink>,
    pub responsible_process: String,
    pub attach_via: Option<AttachVia>,
    pub identity: IdentityReport,
    pub consent_authority: ConsentAuthority,
    pub lock_policy: String,
    /// The settings pane of each permission when it is denied, by permission name.
    pub settings_urls: BTreeMap<String, String>,
    pub relaunch_required: BTreeMap<String, bool>,
}

/// The three permissions every OS reports, in report order.
pub const PERMISSIONS: [&str; 3] = ["capture", "input", "accessibility"];

fn report(state: PermissionState, name: &str, facts: &HostFacts) -> PermissionReport {
    PermissionReport {
        state,
        settings_url: if state == PermissionState::Denied {
            facts.settings_urls.get(name).cloned()
        } else {
            None
        },
        relaunch_required: facts.relaunch_required.get(name).copied(),
    }
}

/// Builds the report from reads alone: the permission probe and `capabilities()`.
pub fn diagnose(backend: &dyn Backend, facts: &HostFacts) -> Diagnosis {
    let probe = backend.probe_permissions();
    let capabilities = backend.capabilities();
    let states = [probe.capture, probe.input, probe.accessibility];
    let permissions = PERMISSIONS
        .iter()
        .zip(states)
        .map(|(name, state)| ((*name).to_owned(), report(state, name, facts)))
        .collect();
    let ok = states.iter().all(|state| *state == PermissionState::Granted)
        && facts.identity.matches == IdentityMatch::Match;
    Diagnosis {
        ok,
        chain: facts.chain.clone(),
        responsible_process: facts.responsible_process.clone(),
        attach_via: facts.attach_via,
        permissions,
        identity: facts.identity.clone(),
        consent_authority: facts.consent_authority,
        session: capabilities.session,
        lock_policy: facts.lock_policy.clone(),
        stop_path: capabilities.stop_path,
        release_helper: capabilities.release_helper,
        observation: UntrustedText,
    }
}

/// The exit code `omo doctor computer` ends on: 0 when ready, 1 when not.
#[must_use]
pub const fn exit_code(diagnosis: &Diagnosis) -> i32 {
    if diagnosis.ok {
        0
    } else {
        1
    }
}

#[cfg(test)]
mod tests;
