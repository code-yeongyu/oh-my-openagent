//! `apps.list()` on macOS: the running window owners plus the running apps with the regular
//! activation policy, then the installed applications, de-duplicated by bundle id with the
//! running record kept, sorted by `(name, appKey)`. A windowless background agent is not listed.

use std::collections::BTreeSet;

use omo_computer_core::listing::{AppInfo, AppSource};
use omo_computer_core::untrusted::UntrustedText;

use super::seam::AppsOs;

/// Every app record, deterministic for the same OS state.
pub fn list(os: &mut dyn AppsOs) -> Vec<AppInfo> {
    let mut seen = BTreeSet::new();
    let mut out = Vec::new();
    for app in os
        .running()
        .into_iter()
        .filter(|a| a.has_windows || a.regular)
    {
        let app_key = app.bundle_id.clone().unwrap_or_else(|| app.name.clone());
        if !seen.insert(app_key.clone()) {
            continue;
        }
        out.push(AppInfo {
            app_key,
            name: app.name,
            pid: Some(app.pid),
            running: true,
            source: AppSource::Running,
            path: app.path,
            identity: None,
            observation: UntrustedText,
        });
    }
    for app in os.installed() {
        if !seen.insert(app.bundle_id.clone()) {
            continue;
        }
        out.push(AppInfo {
            app_key: app.bundle_id,
            name: app.name,
            pid: None,
            running: false,
            source: AppSource::LaunchServices,
            path: Some(app.path),
            identity: None,
            observation: UntrustedText,
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.app_key.cmp(&b.app_key)));
    out
}
