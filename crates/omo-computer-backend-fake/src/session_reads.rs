//! The reads the session's intervention, pause and liveness stages take from the fake: the
//! scripted session state, the last physical input per pid, and the exited targets.

use omo_computer_core::intervention::{
    BackendClock, InterventionSource, TargetLiveness, TargetState,
};
use omo_computer_core::capabilities::Capabilities;
use omo_computer_core::session_state::SessionState;

use crate::backend::FakeBackend;
use crate::clock::FakeClock;
use crate::scenario::state_at;

impl BackendClock for FakeClock {
    fn now_ms(&self) -> u64 {
        Self::now_ms(self)
    }

    fn wait_ms(&self, ms: u64) {
        self.advance(ms);
    }
}

impl InterventionSource for FakeBackend {
    fn frontmost_pid(&self) -> Option<u32> {
        Self::frontmost_pid(self)
    }

    fn last_user_input_ms(&self, pid: u32) -> Option<u64> {
        self.last_input_in(pid)
    }

    fn target_liveness(&self, window: &str) -> Option<TargetLiveness> {
        self.liveness_of(window)
    }

    fn session_state(&self) -> Option<SessionState> {
        self.scripted_session()
    }
}

impl FakeBackend {
    /// The `session_timeline` state at the clock's current time; `None` when none is scripted.
    #[must_use]
    pub fn scripted_session(&self) -> Option<SessionState> {
        let state = self.lock();
        state_at(
            &state.scenario.session_timeline,
            state.elapsed(&self.clock),
            self.clock.now_ms(),
        )
    }

    /// `capabilities` with the scripted session state, when the scenario scripts one; the
    /// gate's lock stage reads the session from the capability vector.
    #[must_use]
    pub(crate) fn with_scripted_session(&self, mut capabilities: Capabilities) -> Capabilities {
        if let Some(session) = self.scripted_session() {
            capabilities.session = session;
        }
        capabilities
    }

    /// The latest scripted physical input in `pid` at or before the clock's current time.
    #[must_use]
    pub fn last_input_in(&self, pid: u32) -> Option<u64> {
        let now = i64::try_from(self.clock.now_ms()).unwrap_or(i64::MAX);
        self.lock()
            .user_inputs
            .iter()
            .filter(|input| input.pid == pid && input.at_ms <= now)
            .map(|input| u64::try_from(input.at_ms).unwrap_or(0))
            .max()
    }

    /// `exited` with the window's pid and scripted exit code once a `target_exit` fired.
    #[must_use]
    pub fn liveness_of(&self, window: &str) -> Option<TargetLiveness> {
        let state = self.lock();
        if !state.exited.contains(window) {
            return None;
        }
        let pid = state.windows.iter().find(|w| w.id == window)?.pid;
        let exit_code = state
            .scenario
            .target_exit
            .iter()
            .find(|exit| exit.window == window)
            .and_then(|exit| exit.exit_code);
        Some(TargetLiveness {
            state: TargetState::Exited,
            pid,
            exit_code,
            signal: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use omo_computer_core::backend::{Backend, InputEvent, Route, TaggedInput};
    use omo_computer_core::intervention::{BackendClock, InterventionSource};
    use omo_computer_core::session_state::Tristate;

    use crate::{FakeBackend, FakeClock, FakeScenario, RecordingSink};

    const WINDOW: &str = r#""windows":[{"id":"101","title":"t","app":"Notes","pid":4242,"x":0,"y":0,"width":100,"height":100,"focused":true,"elevated":null}]"#;

    fn fake(extra: &str) -> FakeBackend {
        let json = format!("{{{WINDOW}{extra}}}");
        let scenario = FakeScenario::from_json(&json).expect("scenario");
        FakeBackend::with_parts(scenario, FakeClock::default(), RecordingSink::default())
    }

    fn reads(backend: &FakeBackend) -> &dyn InterventionSource {
        backend.intervention().expect("the fake reads intervention")
    }

    fn clock(backend: &FakeBackend) -> &dyn BackendClock {
        Backend::clock(backend).expect("the fake has a clock")
    }

    #[test]
    fn session_timeline_drives_the_session_state_under_the_clock() {
        let backend = fake(r#","session_timeline":[{"t_ms":100,"screen_locked":true}]"#);
        let before = reads(&backend).session_state().expect("scripted");
        assert_eq!(before.screen_locked, Tristate::Known(false));
        clock(&backend).wait_ms(100);
        let after = reads(&backend).session_state().expect("scripted");
        assert_eq!(after.screen_locked, Tristate::Known(true));
        assert_eq!(after.sampled_at, clock(&backend).now_ms());
    }

    #[test]
    fn the_capability_vector_carries_the_scripted_session_for_the_gate() {
        let backend = fake(r#","session_timeline":[{"t_ms":0,"screen_locked":true}]"#);
        assert_eq!(backend.capabilities().session.screen_locked, Tristate::Known(true));
        let unscripted = fake("");
        assert_eq!(
            unscripted.capabilities().session,
            omo_computer_core::backend::unknown_session_state()
        );
    }

    #[test]
    fn without_a_timeline_the_fake_reads_no_session_state() {
        let backend = fake("");
        assert_eq!(reads(&backend).session_state(), None);
    }

    #[test]
    fn last_user_input_counts_only_inputs_already_due_in_that_pid() {
        let backend = fake(
            r#","user_input_timeline":[{"t_ms":50,"pid":4242,"kind":"key"},{"t_ms":20,"pid":7,"kind":"key"}]"#,
        );
        let start = clock(&backend).now_ms();
        assert_eq!(reads(&backend).last_user_input_ms(4242), None);
        clock(&backend).wait_ms(60);
        assert_eq!(reads(&backend).last_user_input_ms(4242), Some(start + 50));
        assert_eq!(reads(&backend).frontmost_pid(), Some(4242));
    }

    #[test]
    fn a_fired_target_exit_reads_exited_with_its_code() {
        let mut backend = fake(
            r#","target_exit":[{"after_call":"type_text","nth":1,"window":"101","exit_code":3}]"#,
        );
        assert_eq!(reads(&backend).target_liveness("101"), None);
        let text = TaggedInput {
            event: InputEvent::Text("a".to_owned()),
            tag: 1,
        };
        assert!(backend.post_input(&text, Route::BackgroundWindow).is_ok());
        let liveness = reads(&backend).target_liveness("101").expect("exited");
        assert_eq!((liveness.pid, liveness.exit_code), (4242, Some(3)));
    }
}
