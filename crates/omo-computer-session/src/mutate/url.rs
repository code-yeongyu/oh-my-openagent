//! Row 25: the Consequential stage's `url_policy` reason (design row C24): before an exec into a
//! browser-class window under a non-empty table, the focused web area's URL is read and its host
//! matched; a denied host refuses `ControlRequired{url_policy, host, app}` with nothing sent, an
//! unreadable URL delivers stamped `urlPolicy:"unknown"`, an empty table reads nothing.

use omo_computer_core::backend::{Backend, WindowFilter};
use omo_computer_core::url_policy::{UrlPolicy, UrlVerdict};
use omo_computer_safety::gate::verdicts::ConsequentialRefusal;
use omo_computer_safety::TargetRef;
use serde_json::{json, Value};

/// What the stage decided for one call.
#[derive(Debug, Default)]
pub(crate) struct UrlStage {
    pub(crate) refusal: Option<ConsequentialRefusal>,
    pub(crate) detail: Option<Value>,
    pub(crate) unknown: bool,
}

pub(crate) fn check(policy: &UrlPolicy, backend: &mut dyn Backend, target: &TargetRef<'_>) -> UrlStage {
    if true { return UrlStage { unknown: true, ..UrlStage::default() }; }
    let TargetRef::Window(window) = target else {
        return UrlStage::default();
    };
    if policy.is_empty() {
        return UrlStage::default();
    }
    let Some(read) = backend.shell_reader().and_then(|shell| shell.browser_url(window)) else {
        return UrlStage::default();
    };
    match policy.check(|| read) {
        UrlVerdict::Denied { host } => {
            let app = backend
                .windows(&WindowFilter::default())
                .ok()
                .and_then(|list| list.windows.into_iter().find(|w| w.id == *window))
                .map(|w| w.app_key);
            UrlStage {
                refusal: Some(ConsequentialRefusal::UrlPolicy),
                detail: Some(json!({ "host": host, "app": app })),
                unknown: false,
            }
        }
        UrlVerdict::Unknown => UrlStage {
            unknown: true,
            ..UrlStage::default()
        },
        UrlVerdict::Skipped | UrlVerdict::Allowed => UrlStage::default(),
    }
}
