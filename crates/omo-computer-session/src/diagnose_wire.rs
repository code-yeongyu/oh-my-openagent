//! Row 27's wire method, chained from row 25's last link (R50): `diagnose` answers the readiness
//! report from reads alone. This generic layer has no host facts: the identity is `unknown`, so
//! `ok` is false over the wire until an OS row supplies a matching identity, the lock policy is
//! `unknown`, and it attaches no settings pane of its own. A denial carries a `settingsUrl` only
//! when the backend's own R62 `Backend::diagnose()` returns a permission entry that has one.

use std::collections::BTreeMap;

use omo_computer_core::diagnose::{diagnose, HostFacts};
use omo_computer_core::methods::Method;
use omo_computer_core::params::EmptyParams;
use omo_computer_core::results::{ConsentAuthority, Diagnosis, IdentityMatch, IdentityReport};
use serde_json::{json, Value};

use crate::grant::HostCallError;
use crate::Session;

/// The lock policy before an OS row names its own.
pub const UNKNOWN_LOCK_POLICY: &str = "unknown";

impl Session {
    /// `diagnose`: never prompts, never sends.
    #[must_use]
    pub fn diagnose(&self) -> Diagnosis {
        let facts = HostFacts {
            chain: Vec::new(),
            responsible_process: std::env::current_exe()
                .ok()
                .and_then(|path| path.file_name().map(|name| name.to_string_lossy().into_owned()))
                .unwrap_or_default(),
            attach_via: None,
            identity: IdentityReport { matches: IdentityMatch::Unknown, path: None },
            consent_authority: if self.backend.host_consent().is_some() {
                ConsentAuthority::Host
            } else {
                ConsentAuthority::FileOnly
            },
            lock_policy: UNKNOWN_LOCK_POLICY.to_owned(),
            settings_urls: BTreeMap::new(),
            relaunch_required: BTreeMap::new(),
        };
        diagnose(self.backend.as_ref(), &facts)
    }
}

pub(crate) fn host_call(session: &mut Session, method: Method, params: Value) -> Option<Result<Value, HostCallError>> {
    match method {
        Method::Diagnose => Some(
            serde_json::from_value::<EmptyParams>(params)
                .map_err(HostCallError::Params)
                .map(|_| json!(session.diagnose())),
        ),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use omo_computer_backend_fake::{fixtures_dir, FakeBackend, FakeScenario};
    use omo_computer_core::results::PermissionState::{Denied, Granted, Unknown};

    use crate::Session;

    fn states(session: &Session) -> [omo_computer_core::results::PermissionState; 3] {
        let report = session.diagnose();
        ["capture", "input", "accessibility"].map(|name| report.permissions[name].state)
    }

    #[test]
    fn an_absent_permissions_block_grants_every_permission() {
        let absent = Session::new(Box::new(FakeBackend::new(FakeScenario::default())));
        assert_eq!(states(&absent), [Granted; 3], "absent: all granted (R51)");
        let scripted = FakeScenario::load(&fixtures_dir().join("v3-diagnose-denied.json")).expect("fixture");
        let denied = Session::new(Box::new(FakeBackend::new(scripted)));
        assert_eq!(states(&denied), [Granted, Denied, Unknown]);
        assert!(!denied.diagnose().ok, "a denial is not ready");
    }
    #[test]
    fn the_capabilities_reply_and_diagnose_agree_under_a_scripted_permissions_block() {
        let scripted = FakeScenario::load(&fixtures_dir().join("v3-diagnose-denied.json")).expect("fixture");
        let session = Session::new(Box::new(FakeBackend::new(scripted)));
        let caps = serde_json::to_value(session.capabilities()).expect("caps");
        let wire = |state| serde_json::to_value(state).expect("state").as_str().expect("str").to_lowercase();
        let [capture, input, accessibility] = states(&session);
        assert_eq!(caps["capturePermission"], wire(capture), "{caps}");
        assert_eq!(caps["inputPermission"], wire(input), "{caps}");
        assert_eq!(caps["axPermission"], wire(accessibility), "{caps}");
    }
    struct PanePointingBackend;

    impl omo_computer_core::backend::Backend for PanePointingBackend {
        fn capabilities(&self) -> omo_computer_core::capabilities::Capabilities {
            omo_computer_core::backend::refusing_capabilities()
        }

        fn capture(
            &mut self,
            _target: &omo_computer_core::backend::Target,
            _options: &omo_computer_core::backend::CaptureOptions,
        ) -> omo_computer_core::backend::BackendResult<omo_computer_core::backend::FrameBytes> {
            Err(omo_computer_core::backend::Refusal::bare(omo_computer_core::error::EngineCode::CaptureUnavailable))
        }

        fn diagnose(&self) -> Option<omo_computer_core::backend::BackendProbes> {
            let denied = omo_computer_core::results::PermissionReport {
                state: Denied,
                settings_url: Some("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility".to_owned()),
                relaunch_required: None,
            };
            Some(omo_computer_core::backend::BackendProbes {
                permissions: [("accessibility".to_owned(), denied)].into(),
                ..Default::default()
            })
        }
    }

    #[test]
    fn a_backend_denial_carries_its_settings_pane_over_the_wire_and_ok_stays_false() {
        let session = Session::new(Box::new(PanePointingBackend));
        let wire = serde_json::to_value(session.diagnose()).expect("wire");
        assert_eq!(wire["permissions"]["accessibility"]["state"], "Denied");
        assert_eq!(
            wire["permissions"]["accessibility"]["settingsUrl"],
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
            "the backend's pane reaches the reply"
        );
        assert_eq!(wire["ok"], false, "no host identity on this layer, so never ready");
    }
}
