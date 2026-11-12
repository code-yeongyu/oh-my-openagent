//! Row 22 on the fake: a target that exits mid-text, a window that crashed before admission,
//! and a healthy call that carries no target member.

use super::*;

/// The fake, with its window's process exiting once the clock passes `exit_at_ms`.
struct ExitsAt {
    inner: FakeBackend,
    exit_at_ms: u64,
}

impl ExitsAt {
    fn liveness(clock: &FakeClock, exit_at_ms: u64) -> Option<TargetLiveness> {
        (clock.now_ms() >= exit_at_ms).then_some(TargetLiveness {
            state: TargetState::Exited,
            pid: 4242,
            exit_code: Some(1),
            signal: None,
        })
    }
}

impl Backend for ExitsAt {
    fn capabilities(&self) -> Capabilities {
        self.inner.capabilities()
    }
    fn windows(&mut self, filter: &WindowFilter) -> BackendResult<WindowList> {
        self.inner.windows(filter)
    }
    fn post_input(&mut self, input: &TaggedInput, route: Route) -> BackendResult<Delivered> {
        self.inner.post_input(input, route)
    }
    fn stop_listener(&mut self) -> BackendResult<Box<dyn StopListener>> {
        self.inner.stop_listener()
    }
    fn probe_permissions(&self) -> PermissionProbe {
        self.inner.probe_permissions()
    }
    fn clock(&self) -> Option<&dyn BackendClock> {
        Backend::clock(&self.inner)
    }
    fn intervention(&self) -> Option<&dyn InterventionSource> {
        Some(self)
    }
    fn post_text(
        &mut self,
        text: &str,
        route: Route,
        tag: u64,
        interrupt: &mut dyn FnMut(&dyn Backend) -> bool,
    ) -> TextDelivery {
        let (clock, exit_at_ms) = (self.inner.clock(), self.exit_at_ms);
        let mut exits = |backend: &dyn Backend| {
            Self::liveness(&clock, exit_at_ms).is_some() || interrupt(backend)
        };
        self.inner.post_text(text, route, tag, &mut exits)
    }
}

impl InterventionSource for ExitsAt {
    fn frontmost_pid(&self) -> Option<u32> {
        self.inner.intervention()?.frontmost_pid()
    }
    fn last_user_input_ms(&self, pid: u32) -> Option<u64> {
        self.inner.intervention()?.last_user_input_ms(pid)
    }
    fn target_liveness(&self, _window: &str) -> Option<TargetLiveness> {
        Self::liveness(&self.inner.clock(), self.exit_at_ms)
    }
    fn session_state(&self) -> Option<omo_computer_core::session_state::SessionState> {
        self.inner.intervention()?.session_state()
    }
}

#[test]
fn target_exits_mid_type_reports_exited() {
    let (inner, sink) = fake(r#","typing_unit_ms":10"#);
    let mut session = object_session(Box::new(ExitsAt {
        inner,
        exit_at_ms: 25,
    }));
    let refused = session
        .type_text(params(json!({"target": "101", "text": "abcdefghij"})))
        .expect_err("the process exited after the third grapheme");
    assert_eq!(wire(&refused), ("WindowNotFound", None));
    assert_eq!(refused.stamps.delivered, Some(Delivered { count: 3, of: 10 }));
    assert_eq!(refused.interrupted, Some(Disposition::UNCERTAIN_UNSAFE));
    let target = refused.stamps.target.expect("the exited target");
    assert_eq!(
        (target.state, target.pid, target.exit_code),
        (TargetState::Exited, 4242, Some(1))
    );
    assert_eq!(sink.len(), 1);
}

#[test]
fn a_window_that_crashed_before_admission_is_window_not_found_with_nothing_sent() {
    let (backend, sink) = fake(
        r#","target_exit":[{"after_call":"windows","window":"101","exit_code":0}]"#,
    );
    let mut backend = backend;
    assert!(backend.windows(&WindowFilter::default()).is_ok(), "the read that fires the exit");
    let refused = object_session(Box::new(backend))
        .framed_click(None)
        .expect_err("crashed");
    assert_eq!(wire(&refused), ("WindowNotFound", None));
    assert_eq!(refused.stamps.target, None);
    assert!(sink.is_empty());
}

#[test]
fn a_healthy_call_carries_no_target_member() {
    let (backend, _sink) = fake("");
    let reply = object_session(Box::new(backend))
        .framed_click(None)
        .expect("healthy");
    let value = serde_json::to_value(report(reply)).expect("json");
    assert!(value.get("target").is_none(), "{value}");
    assert!(value.get("session").is_some(), "object mode stamps the session: {value}");
}
