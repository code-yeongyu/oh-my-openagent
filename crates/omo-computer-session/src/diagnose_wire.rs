//! Row 27's wire method, chained from row 25's last link (R50): `diagnose` answers the readiness
//! report from reads alone. On this generic layer the identity and the lock policy are `unknown`;
//! the per-OS rows supply their own.

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
}
