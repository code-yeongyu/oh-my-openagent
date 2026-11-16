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

/// The quit's verdict (R70h): `confirmed` only when a window of the app was listed BEFORE the
/// quit and none is after; "no window left" is necessary, not enough. An app that showed no
/// window before (installed but not running, or running without one) or a listing that could not
/// be read answers `unverifiable` with no evidence: no value the session never read is reported.
pub(super) fn judge(before: Option<bool>, after: Option<bool>) -> ReadBack {
    match (before, after) {
        (Some(true), Some(listed)) => {
            let read = Some(if listed { "running" } else { "exited" }.to_owned());
            ReadBack::judge("exited", read, Some("running".to_owned()))
        }
        _ => ReadBack::judge("exited", None, None),
    }
}

#[cfg(test)]
mod tests {
    use omo_computer_core::report::Effect;

    use super::judge;

    /// Review L1 of #13359: an unreadable listing after the quit is no evidence of "running".
    #[test]
    fn an_unreadable_listing_is_unverifiable_with_no_evidence() {
        let verdict = judge(Some(true), None);
        assert_eq!(verdict.effect, Effect::Unverifiable);
        assert!(verdict.evidence.is_empty(), "{:?}", verdict.evidence);
    }

    #[test]
    fn a_listed_app_is_confirmed_only_once_its_windows_are_gone() {
        assert_eq!(judge(Some(true), Some(false)).effect, Effect::Confirmed);
        assert_eq!(judge(Some(true), Some(true)).effect, Effect::Observed);
        assert_eq!(judge(Some(false), Some(false)).effect, Effect::Unverifiable);
    }
}
