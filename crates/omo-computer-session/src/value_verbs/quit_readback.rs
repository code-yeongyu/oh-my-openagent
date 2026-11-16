//! `apps.quit`'s read-back (R70h): the app's windows listed after the quit, judged against
//! `exited` (moved from value_verbs/mod.rs).

use omo_computer_core::backend::{Backend, WindowFilter};

use super::ReadBack;

/// Whether a window of the app (by key or pid) is listed; `None` when the listing is unreadable.
pub(super) fn app_listed(backend: &mut dyn Backend, app_key: &str, pid: Option<u32>) -> Option<bool> {
    backend
        .windows(&WindowFilter::default())
        .ok()
        .map(|list| list.windows.iter().any(|w| w.app_key == app_key || pid.is_some_and(|pid| w.identity.pid == pid)))
}

/// The quit's verdict from the listing read after it.
pub(super) fn judge(after: Option<bool>) -> ReadBack {
    let running = after.unwrap_or(true);
    let read = Some(if running { "running" } else { "exited" }.to_owned());
    ReadBack::judge("exited", read, Some("running".to_owned()))
}
