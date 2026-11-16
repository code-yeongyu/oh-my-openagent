//! What an engine the host did not spawn hands its session after `session.open` (row 28,
//! DESIGN-GAPS-ROW28 G2 bound by R70k): the consent view may only NARROW - the narrower of the
//! view the session opened with, the hand's `consent.json` the engine read itself, and the
//! `--mcp --tier` request. Nothing here can grant what the opened view did not.

use omo_computer_safety::protected::Os;

use crate::consent::Consent;
use crate::mutate::LOCAL_HAND;
use crate::Session;

/// The engine's narrowing of the opened consent view.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ConsentNarrowing {
    /// The hand's file allows computer use (absent file: `false`, d-remote.md:207).
    pub computer_use: bool,
    /// The requested tier is `exec`; `false` keeps the run at `computer:read`.
    pub exec_tier: bool,
    /// The file is present but not trustworthy, or a live host's fingerprint differs.
    pub tampered: bool,
}

impl Session {
    /// Narrows the open session's consent view; a call before `session.open` changes nothing.
    pub fn narrow_consent(&mut self, narrowing: ConsentNarrowing) {
        if self.opened.is_none() {
            return;
        }
        let mut view = self.funnel.control.consent.view().clone();
        view.computer_use &= narrowing.computer_use;
        view.tampered |= narrowing.tampered;
        if !narrowing.exec_tier {
            view.grants.retain(|grant| !grant.starts_with("computer:exec"));
            view.full_access = false;
        }
        self.funnel.control.consent = Consent::new(view, LOCAL_HAND, Os::host());
    }
}

#[cfg(test)]
mod tests {
    use omo_computer_backend_fake::{FakeBackend, FakeClock, FakeScenario, RecordingSink, StopPathScript};
    use omo_computer_core::params::{SessionOpenParams, StopPathStartParams};
    use serde_json::json;

    use super::*;

    const NOTES: &str = r#"{"windows":[{"id":"101","title":"t","app":"Notes","pid":4242,"x":0,"y":0,"width":800,"height":600,"focused":true,"elevated":null}]}"#;

    fn opened(sink: &RecordingSink) -> Session {
        let scenario = FakeScenario::from_json(NOTES).expect("scenario");
        let backend = FakeBackend::with_parts(scenario, FakeClock::default(), sink.clone())
            .with_stop_path(StopPathScript::Live);
        let mut session = Session::new(Box::new(backend));
        session.open(serde_json::from_value::<SessionOpenParams>(json!({})).expect("params")).expect("open");
        session.stop_path_start(serde_json::from_value::<StopPathStartParams>(json!({})).expect("params"));
        session
    }

    fn click(session: &mut Session) -> Result<(), String> {
        let capture = serde_json::from_value(json!({"target": "101"})).expect("params");
        session.capture(capture).map_err(|refusal| format!("{refusal:?}"))?;
        let params = serde_json::from_value(json!({"target": "101", "x": 10, "y": 10})).expect("params");
        session.click(params).map(drop).map_err(|refused| format!("{:?}", refused.refusal))
    }

    #[test]
    fn a_read_tier_refuses_exec_with_nothing_sent() {
        let sink = RecordingSink::default();
        let mut session = opened(&sink);
        session.narrow_consent(ConsentNarrowing { computer_use: true, exec_tier: false, tampered: false });
        assert!(click(&mut session).is_err());
        assert!(sink.lines().iter().all(|line| !line.starts_with("post_input")), "{:?}", sink.lines());
    }

    #[test]
    fn computer_use_off_refuses_exec_even_at_the_exec_tier() {
        let mut session = opened(&RecordingSink::default());
        session.narrow_consent(ConsentNarrowing { computer_use: false, exec_tier: true, tampered: false });
        let refused = click(&mut session).expect_err("refused");
        assert!(refused.contains("consent_off") || refused.contains("ConsentOff"), "{refused}");
    }

    #[test]
    fn a_full_narrowing_keeps_the_opened_view() {
        let mut session = opened(&RecordingSink::default());
        session.narrow_consent(ConsentNarrowing { computer_use: true, exec_tier: true, tampered: false });
        assert!(click(&mut session).is_ok());
    }
}
