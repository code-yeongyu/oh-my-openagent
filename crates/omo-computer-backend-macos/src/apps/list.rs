//! `apps.list()` on macOS: the running window owners plus the running apps with the regular
//! activation policy, then the installed applications, de-duplicated by bundle id with the
//! running record kept, sorted by `(name, appKey)`. A windowless background agent is not listed.
//! When one bundle id has several running processes, the window owner wins, then the oldest
//! (lowest) pid, so the pid never depends on the order the OS lists processes in.

use std::collections::{BTreeMap, BTreeSet};

use omo_computer_core::listing::{AppInfo, AppSource};
use omo_computer_core::untrusted::UntrustedText;

use super::seam::{AppsOs, RunningApp};

/// Every app record, deterministic for the same OS state.
pub fn list(os: &mut dyn AppsOs) -> Vec<AppInfo> {
    let mut running = BTreeMap::new();
    for app in os
        .running()
        .into_iter()
        .filter(|a| a.has_windows || a.regular)
    {
        let app_key = app.bundle_id.clone().unwrap_or_else(|| app.name.clone());
        running
            .entry(app_key)
            .and_modify(|kept: &mut RunningApp| {
                if (!app.has_windows, app.pid) < (!kept.has_windows, kept.pid) {
                    *kept = app.clone();
                }
            })
            .or_insert(app);
    }
    let mut seen = BTreeSet::new();
    let mut out = Vec::new();
    for (app_key, app) in running {
        seen.insert(app_key.clone());
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
