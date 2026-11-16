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
    let mut permissions: BTreeMap<String, PermissionReport> = PERMISSIONS
        .iter()
        .zip(states)
        .map(|(name, state)| ((*name).to_owned(), report(state, name, facts)))
        .collect();
    let mut chain = facts.chain.clone();
    let mut checks = Vec::new();
    if let Some(probes) = backend.diagnose() {
        chain.extend(probes.chain);
        permissions.extend(probes.permissions);
        checks = probes.checks;
    }
    let ok = permissions.values().all(|report| report.state == PermissionState::Granted)
        && facts.identity.matches == IdentityMatch::Match;
    Diagnosis {
        ok,
        chain,
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
        checks,
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
        extra: Option<crate::backend::BackendProbes>,
        probes: Cell<u32>,
        captures: Cell<u32>,
    }

    impl Backend for ProbeOnly {
        fn capabilities(&self) -> Capabilities {
            refusing_capabilities()
        }

        fn diagnose(&self) -> Option<crate::backend::BackendProbes> {
            self.extra.clone()
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
            extra: None,
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
    #[test]
    fn no_backend_probes_leave_the_report_as_it_was() {
        use PermissionState::Granted;
        let diagnosis = diagnose(&backend(Granted, Granted, Granted), &facts(IdentityMatch::Match));
        let wire = serde_json::to_value(&diagnosis).expect("wire");
        assert!(wire.get("checks").is_none(), "no checks member when the backend adds none");
        assert_eq!(diagnosis.permissions.len(), 3);
        assert!(diagnosis.chain.is_empty());
        assert!(diagnosis.ok);
    }

    #[test]
    fn backend_probes_join_the_report_and_checks_never_feed_ok() {
        use crate::results::{ChainLink, ChainRole, PermissionReport, ProbeCheck, ProbeState};
        use PermissionState::{Denied, Granted};
        let mut probing = backend(Granted, Granted, Granted);
        probing.extra = Some(crate::backend::BackendProbes {
            chain: vec![ChainLink { role: ChainRole::Helper, pid: 7, path: "x11-helper".to_owned(), cdhash: None, session_context: "x11".to_owned() }],
            permissions: [("accessibility".to_owned(), PermissionReport { state: Denied, settings_url: None, relaunch_required: None })].into(),
            checks: vec![ProbeCheck { name: "compositor".to_owned(), state: ProbeState::Unavailable, reason: Some("none_running".to_owned()) }],
        });
        let diagnosis = diagnose(&probing, &facts(IdentityMatch::Match));
        assert_eq!(diagnosis.chain.len(), 1, "the backend's link joins the chain");
        assert_eq!(diagnosis.permissions["accessibility"].state, Denied, "a backend entry replaces the generic probe");
        assert!(!diagnosis.ok, "a backend denial is not ready");
        let wire = serde_json::to_value(&diagnosis).expect("wire");
        assert_eq!(wire["checks"], serde_json::json!([{ "name": "compositor", "state": "unavailable", "reason": "none_running" }]));
        probing.extra.as_mut().expect("probes").permissions.clear();
        assert!(diagnose(&probing, &facts(IdentityMatch::Match)).ok, "an unavailable check alone never makes ok false");
    }
}
