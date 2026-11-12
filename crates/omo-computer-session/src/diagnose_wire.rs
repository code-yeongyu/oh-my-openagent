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
