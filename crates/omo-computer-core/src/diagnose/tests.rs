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
