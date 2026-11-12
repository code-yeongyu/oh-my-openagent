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
mod tests {
    use std::cell::Cell;
    use std::collections::BTreeMap;

    use crate::backend::{
        refusing_capabilities, unknown_session_state, Backend, BackendResult, CaptureOptions,
        FrameBytes, PermissionProbe, Refusal, Target,
    };
    use crate::capabilities::Capabilities;
    use crate::error::EngineCode;
    use crate::results::{ConsentAuthority, IdentityMatch, IdentityReport, PermissionState};

    use super::{diagnose, exit_code, HostFacts, PERMISSIONS};

    struct ProbeOnly {
        probe: PermissionProbe,
        probes: Cell<u32>,
        captures: Cell<u32>,
    }

    impl Backend for ProbeOnly {
        fn capabilities(&self) -> Capabilities {
            refusing_capabilities()
        }

        fn probe_permissions(&self) -> PermissionProbe {
            self.probes.set(self.probes.get() + 1);
            self.probe
        }

        fn capture(&mut self, _target: &Target, _options: &CaptureOptions) -> BackendResult<FrameBytes> {
            self.captures.set(self.captures.get() + 1);
            Err(Refusal::bare(EngineCode::CaptureUnavailable))
        }
    }

    fn backend(capture: PermissionState, input: PermissionState, accessibility: PermissionState) -> ProbeOnly {
        ProbeOnly {
            probe: PermissionProbe { capture, input, accessibility },
            probes: Cell::new(0),
            captures: Cell::new(0),
        }
    }

    fn facts(matches: IdentityMatch) -> HostFacts {
        HostFacts {
            chain: Vec::new(),
            responsible_process: "omo".to_owned(),
            attach_via: None,
            identity: IdentityReport { matches, path: None },
            consent_authority: ConsentAuthority::Host,
            lock_policy: "per_call".to_owned(),
            settings_urls: PERMISSIONS
                .iter()
                .map(|name| ((*name).to_owned(), format!("settings://{name}")))
                .collect::<BTreeMap<_, _>>(),
            relaunch_required: BTreeMap::new(),
        }
    }

    #[test]
    fn every_permission_is_tri_state_and_each_denial_points_at_its_settings_pane() {
        use PermissionState::{Denied, Granted, Unknown};
        let diagnosis = diagnose(&backend(Granted, Denied, Unknown), &facts(IdentityMatch::Match));
        let states: Vec<PermissionState> =
            PERMISSIONS.iter().map(|name| diagnosis.permissions[*name].state).collect();
        assert_eq!(states, [Granted, Denied, Unknown]);
        assert_eq!(diagnosis.permissions["input"].settings_url.as_deref(), Some("settings://input"));
        assert_eq!(diagnosis.permissions["capture"].settings_url, None, "granted needs no pane");
        assert_eq!(diagnosis.permissions["accessibility"].settings_url, None, "unknown is not denied");
        assert!(!diagnosis.ok);
        assert_eq!(exit_code(&diagnosis), 1);
    }

    #[test]
    fn the_report_reads_and_never_prompts() {
        use PermissionState::Denied;
        let backend = backend(Denied, Denied, Denied);
        let diagnosis = diagnose(&backend, &facts(IdentityMatch::Match));
        assert_eq!(backend.probes.get(), 1, "the probe is read once");
        assert_eq!(backend.captures.get(), 0, "diagnose never captures, so nothing can prompt");
        assert!(diagnosis.permissions.values().all(|report| report.settings_url.is_some()));
    }

    #[test]
    fn ready_only_when_every_permission_is_granted_and_the_identity_matches() {
        use PermissionState::Granted;
        let granted = backend(Granted, Granted, Granted);
        let ready = diagnose(&granted, &facts(IdentityMatch::Match));
        assert!(ready.ok);
        assert_eq!(exit_code(&ready), 0);
        for matches in [IdentityMatch::Mismatch, IdentityMatch::Unknown] {
            let diagnosis = diagnose(&granted, &facts(matches));
            assert!(!diagnosis.ok, "{matches:?} is not ready");
            assert_eq!(exit_code(&diagnosis), 1);
        }
    }

    #[test]
    fn the_session_block_carries_the_live_state_and_the_lock_policy() {
        use PermissionState::Granted;
        let diagnosis = diagnose(&backend(Granted, Granted, Granted), &facts(IdentityMatch::Match));
        assert_eq!(diagnosis.session, unknown_session_state());
        assert_eq!(diagnosis.lock_policy, "per_call");
        assert_eq!(diagnosis.stop_path, refusing_capabilities().stop_path);
    }
}
