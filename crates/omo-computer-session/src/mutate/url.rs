//! Row 25: the Consequential stage's `url_policy` reason (design row C24): before an exec into a
//! browser-class window under a non-empty table, the focused web area's URL is read and its host
//! matched; a denied host refuses `ControlRequired{url_policy, host, app}` with nothing sent, an
//! unreadable URL delivers stamped `urlPolicy:"unknown"`, an empty table reads nothing.

use omo_computer_core::backend::{Backend, WindowFilter};
use omo_computer_core::listing::WindowInfo;
use omo_computer_core::url_policy::{UrlPolicy, UrlVerdict};
use omo_computer_safety::gate::verdicts::ConsequentialRefusal;
use omo_computer_safety::gate::VerbKind;
use omo_computer_safety::{Call, TargetRef};
use serde_json::{json, Value};

/// What the stage decided for one call.
#[derive(Debug, Default)]
pub(crate) struct UrlStage {
    pub(crate) refusal: Option<ConsequentialRefusal>,
    pub(crate) detail: Option<Value>,
    pub(crate) unknown: bool,
}

impl crate::Session {
    /// Row 25's URL-policy and per-point target stages on a fresh plan (the first pass and every
    /// re-admit, so a re-admission never drops them); answers the Consequential refusal's detail.
    pub(super) fn url_stages(&mut self, plan: &mut crate::grant::Plan, mutation: &super::Mutation<'_>) -> Option<Value> {
        let url = check(&self.funnel.url_policy, self.backend.as_mut(), &mutation.call);
        plan.stages.consequential = url.refusal;
        plan.stages.targets = mutation.targets.clone();
        self.funnel.url_unknown = url.unknown;
        url.detail
    }
}

pub(crate) fn check(policy: &UrlPolicy, backend: &mut dyn Backend, call: &Call<'_>) -> UrlStage {
    if policy.is_empty() {
        return UrlStage::default();
    }
    let windows = backend
        .windows(&WindowFilter::default())
        .map(|list| list.windows)
        .unwrap_or_default();
    let mut stage = UrlStage::default();
    for window in reached(&windows, call) {
        let Some(read) = backend
            .shell_reader()
            .and_then(|shell| shell.browser_url(&window.id))
        else {
            continue;
        };
        match policy.check(|| read) {
            UrlVerdict::Denied { host } => {
                return UrlStage {
                    refusal: Some(ConsequentialRefusal::UrlPolicy),
                    detail: Some(json!({ "host": host, "app": window.app_key })),
                    unknown: false,
                };
            }
            UrlVerdict::Unknown => stage.unknown = true,
            UrlVerdict::Skipped | UrlVerdict::Allowed => {}
        }
    }
    stage
}

/// The windows a call reaches, by the target resolver's rules (`omo_computer_safety::resolve`):
/// a window target is its own window plus the window under any point outside its frame; a
/// desktop pointer call is the topmost unminimized window under each point; a desktop keyboard
/// call is the focused window (review M2 of #13347).
fn reached<'w>(windows: &'w [WindowInfo], call: &Call<'_>) -> Vec<&'w WindowInfo> {
    let under = |x: f64, y: f64| {
        windows
            .iter()
            .filter(|w| {
                !w.minimized
                    && x >= w.bounds.x
                    && y >= w.bounds.y
                    && x < w.bounds.x + w.bounds.width
                    && y < w.bounds.y + w.bounds.height
            })
            .min_by_key(|w| w.z)
    };
    let mut out: Vec<&WindowInfo> = Vec::new();
    let mut add = |w: Option<&'w WindowInfo>| {
        if let Some(w) = w {
            if !out.iter().any(|seen| seen.id == w.id) {
                out.push(w);
            }
        }
    };
    match call.target {
        TargetRef::Window(id) => {
            let own = windows.iter().find(|w| w.id == id);
            add(own);
            if let Some(own) = own {
                for p in &call.points {
                    if p.x < 0.0 || p.y < 0.0 || p.x >= own.bounds.width || p.y >= own.bounds.height
                    {
                        add(under(own.bounds.x + p.x, own.bounds.y + p.y));
                    }
                }
            }
        }
        TargetRef::Desktop if call.verb == VerbKind::Keyboard => {
            add(windows.iter().find(|w| w.focused))
        }
        TargetRef::Desktop => {
            for p in &call.points {
                add(under(p.x, p.y));
            }
        }
    }
    out
}
