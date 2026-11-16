//! The fake's feed of the user's own presses: tests push presses directly
//! (`FakeUserInput::press`), and a scenario scripts a press that lands right
//! before the fake's next press of a method (`user_presses`), the way a real
//! user clicks while keys are going out.

use std::collections::{BTreeMap, VecDeque};
use std::sync::Arc;
use std::time::Instant;

use parking_lot::Mutex;
use senpi_desktop_core::error::CoreResult;
use senpi_desktop_core::user_input::{UserInputFeed, UserPress, UserPressKind, UserPresses};
use serde::Deserialize;

use crate::fake::FakeBackend;
use crate::method::FakeMethod;

/// A user press the scenario lands right before the fake's next press of
/// `before`: `{"before": "type_text", "pid": 4242, "kind": "click"}`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScriptedUserPress {
    pub before: FakeMethod,
    pub pid: u32,
    #[serde(default = "click")]
    pub kind: ScriptedPressKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScriptedPressKind {
    Key,
    Click,
}

const fn click() -> ScriptedPressKind {
    ScriptedPressKind::Click
}

#[derive(Default)]
struct State {
    presses: VecDeque<UserPress>,
    dropped: u64,
    started: BTreeMap<u32, u64>,
    scripted: Vec<ScriptedUserPress>,
    /// `user_input_timeline` presses not yet due, oldest first.
    timed: VecDeque<UserPress>,
}

/// The fake's shared feed; clones observe the same record.
#[derive(Default)]
pub struct FakeUserInput(Mutex<State>);

impl FakeUserInput {
    /// The user pressed a key or clicked in `pid` now.
    pub fn press(&self, pid: u32, kind: UserPressKind) {
        self.0.lock().presses.push_back(UserPress { pid, kind, at: Instant::now() });
    }

    /// Presses the bounded record let go before anyone read them.
    pub fn drop_presses(&self, count: u64) {
        self.0.lock().dropped += count;
    }

    /// When process `pid` started, as the feed reports it.
    pub fn set_started(&self, pid: u32, started: u64) {
        self.0.lock().started.insert(pid, started);
    }

    pub(crate) fn script(&self, presses: Vec<ScriptedUserPress>) {
        self.0.lock().scripted = presses;
    }

    /// Places each timeline press at `t_ms` from now; the past ones are in
    /// the record at once, the rest once their time has come.
    pub(crate) fn script_timeline(&self, timeline: &[crate::scripting::TimedUserPress]) {
        let now = Instant::now();
        let mut presses: Vec<UserPress> = timeline
            .iter()
            .map(|press| {
                let offset = std::time::Duration::from_millis(press.t_ms.unsigned_abs());
                let at = if press.t_ms < 0 { now.checked_sub(offset) } else { now.checked_add(offset) };
                let at = at.unwrap_or_else(|| {
                    panic!("user_input_timeline t_ms {} is not representable on this host's monotonic clock", press.t_ms)
                });
                UserPress { pid: press.pid, kind: press_kind(press.kind), at }
            })
            .collect();
        presses.sort_by_key(|press| press.at);
        let mut state = self.0.lock();
        state.timed = presses.into();
        land_due(&mut state, now);
    }

    /// Lands every scripted press waiting for `method`.
    pub(crate) fn before(&self, method: FakeMethod) {
        let mut state = self.0.lock();
        let (now, later): (Vec<_>, Vec<_>) = std::mem::take(&mut state.scripted).into_iter().partition(|p| p.before == method);
        state.scripted = later;
        for press in now {
            state.presses.push_back(UserPress { pid: press.pid, kind: press_kind(press.kind), at: Instant::now() });
        }
    }
}

const fn press_kind(kind: ScriptedPressKind) -> UserPressKind {
    match kind {
        ScriptedPressKind::Key => UserPressKind::Key,
        ScriptedPressKind::Click => UserPressKind::Click,
    }
}

/// Moves every timeline press due by `now` into the record at its own press
/// time, so the record stays in press order however late `take` runs: a
/// press recorded after a timeline press fell due still sorts behind it.
fn land_due(state: &mut State, now: Instant) {
    let due = state.timed.partition_point(|press| press.at <= now);
    for press in state.timed.drain(..due) {
        let slot = state
            .presses
            .partition_point(|recorded| recorded.at <= press.at);
        state.presses.insert(slot, press);
    }
}

impl UserInputFeed for FakeUserInput {
    fn take(&self) -> UserPresses {
        let mut state = self.0.lock();
        land_due(&mut state, Instant::now());
        UserPresses { presses: state.presses.drain(..).collect(), dropped: std::mem::take(&mut state.dropped) }
    }

    fn process_started(&self, pid: u32) -> Option<u64> {
        self.0.lock().started.get(&pid).copied()
    }
}

impl FakeBackend {
    /// The feed a test pushes the user's presses into.
    pub fn user_input(&self) -> Arc<FakeUserInput> {
        Arc::clone(&self.user_input)
    }

    /// The fake's press of `method` is about to go out: scripted user presses
    /// waiting for it land first, then the session's press check runs.
    pub(crate) fn press_check(&self, method: FakeMethod) -> CoreResult<()> {
        self.user_input.before(method);
        senpi_desktop_core::intervention::check_press()
    }
}
