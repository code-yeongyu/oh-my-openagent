//! The review of #13355 at b3227b53b2: nothing is sent on a gate pass older than the last wait.
//! A stop during the takeover re-check refuses with nothing sent (H1); a foreign input inside the
//! attribution window when the re-check ends holds the send (M1); the re-check waits only what is
//! left of the call's ceiling (L1); consecutive waits for one reason report as one pause (L2).

use super::*;

pub(super) const BUSY_UNTIL_300: &str = r#""busy_timeline":[{"t_ms":0,"window":"101","busy":true,"indicator":"spinner"},{"t_ms":300,"window":"101","busy":false}]"#;

pub(super) fn key_inputs(times: impl IntoIterator<Item = u64>) -> String {
    let inputs: Vec<String> = times
        .into_iter()
        .map(|t| format!(r#"{{"t_ms":{t},"pid":4242,"kind":"key"}}"#))
        .collect();
    format!(r#""user_input_timeline":[{}]"#, inputs.join(","))
}

/// The fake, its target no longer frontmost once the clock reaches `away_at_ms` or on the one
/// frontmost read `away_read` names (`(from_ms, n)`: the n-th read at or after `from_ms`, from 1),
/// and the stop chord pressed once the clock reaches `stop_at_ms` (the fake fires `stop_timeline`
/// presses only from its settle reads, never from a pause's clock wait).
pub(super) struct Scripted {
    pub(super) inner: FakeBackend,
    pub(super) away_at_ms: Option<u64>,
    pub(super) away_read: Option<(u64, usize)>,
    pub(super) stop_at_ms: Option<u64>,
    pub(super) reads: std::sync::atomic::AtomicUsize,
}

impl Scripted {
    pub(super) fn new(inner: FakeBackend) -> Self {
        Self {
            inner,
            away_at_ms: None,
            away_read: None,
            stop_at_ms: None,
            reads: std::sync::atomic::AtomicUsize::new(0),
        }
    }
}

/// The fake's stop listener, with one press heard once the clock reaches `at_ms`.
struct StopAt {
    inner: Box<dyn StopListener>,
    clock: FakeClock,
    at_ms: Option<u64>,
}

impl StopListener for StopAt {
    fn poll_stop(&mut self) -> BackendResult<bool> {
        let heard = self.inner.poll_stop()?;
        let now_ms = self.clock.now_ms();
        Ok(heard || self.at_ms.take_if(|at_ms| now_ms >= *at_ms).is_some())
    }
}

impl Backend for Scripted {
    fn capabilities(&self) -> Capabilities {
        self.inner.capabilities()
    }
    fn windows(&mut self, filter: &WindowFilter) -> BackendResult<WindowList> {
        self.inner.windows(filter)
    }
    fn displays(&mut self) -> BackendResult<Vec<omo_computer_core::results::DisplayInfo>> {
        self.inner.displays()
    }
    fn capture(
        &mut self,
        target: &omo_computer_core::backend::Target,
        options: &omo_computer_core::backend::CaptureOptions,
    ) -> BackendResult<omo_computer_core::backend::FrameBytes> {
        self.inner.capture(target, options)
    }
    fn post_input(&mut self, input: &TaggedInput, route: Route) -> BackendResult<Delivered> {
        self.inner.post_input(input, route)
    }
    fn stop_listener(&mut self) -> BackendResult<Box<dyn StopListener>> {
        Ok(Box::new(StopAt {
            inner: self.inner.stop_listener()?,
            clock: self.inner.clock(),
            at_ms: self.stop_at_ms,
        }))
    }
    fn probe_permissions(&self) -> PermissionProbe {
        self.inner.probe_permissions()
    }
    fn epoch_source(&mut self) -> Box<dyn omo_computer_core::backend::EpochSource> {
        self.inner.epoch_source()
    }
    fn clock(&self) -> Option<&dyn BackendClock> {
        Backend::clock(&self.inner)
    }
    fn intervention(&self) -> Option<&dyn InterventionSource> {
        Some(self)
    }
    fn settle_source(&mut self) -> Option<Box<dyn omo_computer_core::backend::SettleSource>> {
        self.inner.settle_source()
    }
    fn code_identity(&self, pid: u32) -> Option<omo_computer_core::listing::CodeIdentity> {
        self.inner.code_identity(pid)
    }
    fn executable_path(&self, pid: u32) -> Option<String> {
        self.inner.executable_path(pid)
    }
    fn host_consent(&self) -> Option<serde_json::Value> {
        self.inner.host_consent()
    }
    fn platform(&self) -> Option<omo_computer_core::report::Platform> {
        self.inner.platform()
    }
    fn set_stop_chord(&mut self, chord: Option<&str>) -> BackendResult<()> {
        self.inner.set_stop_chord(chord)
    }
}

impl InterventionSource for Scripted {
    fn frontmost_pid(&self) -> Option<u32> {
        let now_ms = self.inner.clock().now_ms();
        let flicker = self.away_read.is_some_and(|(from_ms, n)| {
            now_ms >= from_ms
                && self.reads.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1 == n
        });
        if flicker || self.away_at_ms.is_some_and(|away_at_ms| now_ms >= away_at_ms) {
            return Some(9_999);
        }
        self.inner.intervention()?.frontmost_pid()
    }
    fn last_user_input_ms(&self, pid: u32) -> Option<u64> {
        self.inner.intervention()?.last_user_input_ms(pid)
    }
    fn target_liveness(&self, window: &str) -> Option<TargetLiveness> {
        self.inner.intervention()?.target_liveness(window)
    }
    fn session_state(&self) -> Option<omo_computer_core::session_state::SessionState> {
        self.inner.intervention()?.session_state()
    }
}

/// H1: the user works in the target during the busy wait, then presses stop while the takeover
/// re-check waits for them. The stop ends the wait; the gate must run again and refuse.
#[test]
fn h1_a_stop_during_the_takeover_recheck_refuses_with_nothing_sent() {
    let (inner, sink) = fake(&format!(r#",{BUSY_UNTIL_300},{}"#, key_inputs([100])));
    let backend = Scripted {
        stop_at_ms: Some(600),
        ..Scripted::new(inner)
    };
    let refused = object_session(Box::new(backend))
        .framed_click(None)
        .expect_err("the stop latched during the re-check wait");
    assert_eq!(refused.refusal.code.wire(), "Suspended", "{refused:?}");
    assert!(
        sink.is_empty(),
        "nothing sent after the stop: {:?}",
        sink.lines()
    );
}

/// M1 (R70s(5)): the user types in the target and switches away; the re-check ends on that tick,
/// so the last input is inside the attribution window right before the send and must hold it.
#[test]
fn m1_a_foreign_input_just_before_the_recheck_ends_holds_the_send() {
    let (inner, sink) = fake(&format!(
        r#",{BUSY_UNTIL_300},{}"#,
        key_inputs([100].into_iter().chain((1_000..=2_000).step_by(10)))
    ));
    let backend = Scripted {
        away_at_ms: Some(1_300),
        ..Scripted::new(inner)
    };
    let refused = object_session(Box::new(backend))
        .framed_click(None)
        .expect_err("the input right before the send holds it");
    assert_eq!(wire(&refused), ("UserIntervened", None), "{refused:?}");
    assert!(sink.is_empty(), "nothing sent: {:?}", sink.lines());
}

/// L1: the call's pauses together stay within `pause_ceiling_ms` (120 s by default): a re-check
/// after a 119.5 s admission pause has only the rest of the ceiling left.
#[test]
fn l1_the_recheck_waits_only_what_is_left_of_the_ceiling() {
    let steady = (0..=118_000).step_by(1_000);
    let again = (119_600..=130_000).step_by(1_000);
    let (backend, sink) = fake(&format!(
        r#","busy_timeline":[{{"t_ms":0,"window":"101","busy":true,"indicator":"spinner"}},{{"t_ms":120000,"window":"101","busy":false}}],{}"#,
        key_inputs(steady.chain(again))
    ));
    let refused = object_session(Box::new(backend))
        .framed_click(None)
        .expect_err("the user was still active when the ceiling ran out");
    assert_eq!(wire(&refused), ("UserIntervened", None), "{refused:?}");
    let paused: u64 = refused.stamps.paused.iter().map(|p| p.ms).sum();
    assert!(
        paused <= 120_000 + omo_computer_core::intervention::PAUSE_TICK_MS,
        "{:?}",
        refused.stamps.paused
    );
    assert!(sink.is_empty(), "{:?}", sink.lines());
}

/// L2: a takeover wait at admission and another at the re-check report as one `UserActive` pause,
/// as `Pauses::add` merges consecutive waits for one reason.
#[test]
fn l2_consecutive_user_active_waits_report_as_one_pause() {
    let (backend, sink) = fake(&format!(
        r#","busy_timeline":[{{"t_ms":0,"window":"101","busy":true,"indicator":"spinner"}},{{"t_ms":2000,"window":"101","busy":false}}],{}"#,
        key_inputs([0, 1_800])
    ));
    let reply = object_session(Box::new(backend))
        .framed_click(None)
        .expect("sent once the user paused");
    let paused = report(reply).paused().to_vec();
    assert_eq!(paused.len(), 1, "{paused:?}");
    assert_eq!(paused[0].reason, PauseReason::UserActive);
    assert_eq!(sink.len(), 3, "{:?}", sink.lines());
}
