//! The mutable state behind one fake backend, shared with the handles it hands out.

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use omo_computer_core::backend::{EpochChange, Refusal};
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::params::Point;

use crate::clock::FakeClock;
use crate::faults::{Fault, FaultQueue};
use crate::method::{CallCounter, FakeMethod};
use crate::scenario::{FakeDisplay, FakeScenario, FakeWindow, FocusRecordKind, UserPress};
use crate::timeline::{self, UserInput};

/// What the call body runs after the fault check.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CallOutcome {
    Proceed,
    /// An AX write goes out and is never answered.
    CannotComplete,
}

#[derive(Debug)]
pub struct FakeState {
    pub scenario: FakeScenario,
    pub start_ms: u64,
    pub windows: Vec<FakeWindow>,
    pub displays: Vec<FakeDisplay>,
    pub process_start: BTreeMap<String, u64>,
    pub exited: BTreeSet<String>,
    pub calls: CallCounter,
    pub faults: FaultQueue,
    pub pending_presses: Vec<UserPress>,
    pub user_inputs: Vec<UserInput>,
    pub epochs: VecDeque<EpochChange>,
    pub cursor: Option<Point>,
    pub held: BTreeSet<String>,
    pub clipboard: Option<String>,
    pub focus_read_pos: BTreeMap<String, usize>,
    pub focus_record_pos: BTreeMap<FocusRecordKind, usize>,
    /// Snapshot generation -> the window it walked.
    pub snapshots: BTreeMap<u64, String>,
    /// Root reads per window: which `ax_versions` entry the window serves.
    pub ax_reads: BTreeMap<String, usize>,
    pub ax_event_pos: usize,
    pub stop_pressed: bool,
    /// Row 50: the user pressed the lease-end key (a bare physical Escape).
    pub lease_end_pressed: bool,
}

impl FakeState {
    pub fn new(mut scenario: FakeScenario, start_ms: u64) -> Self {
        scenario
            .ax_notification_timeline
            .sort_by_key(|event| event.t_ms);
        let mut faults = FaultQueue::default();
        for failure in &scenario.fail_next {
            faults.push(
                failure.method,
                Fault::Fail {
                    code: failure.code,
                    reason: failure.reason,
                },
            );
        }
        for method in &scenario.ax_cannot_complete {
            faults.push(*method, Fault::CannotComplete);
        }
        let process_start = scenario
            .identity
            .iter()
            .map(|(id, script)| (id.clone(), script.process_start))
            .collect();
        Self {
            start_ms,
            windows: scenario.windows.clone(),
            displays: scenario.displays.clone(),
            process_start,
            exited: BTreeSet::new(),
            calls: CallCounter::default(),
            faults,
            pending_presses: scenario.user_presses.clone(),
            user_inputs: timeline::absolute(&scenario.user_input_timeline, start_ms),
            epochs: VecDeque::new(),
            cursor: scenario.cursor,
            held: BTreeSet::new(),
            clipboard: scenario.clipboard.as_ref().and_then(|c| c.text.clone()),
            focus_read_pos: BTreeMap::new(),
            focus_record_pos: BTreeMap::new(),
            snapshots: BTreeMap::new(),
            ax_reads: BTreeMap::new(),
            ax_event_pos: 0,
            stop_pressed: false,
            lease_end_pressed: false,
            scenario,
        }
    }

    pub fn elapsed(&self, clock: &FakeClock) -> u64 {
        clock.now_ms().saturating_sub(self.start_ms)
    }

    /// Counts the call, charges its delay, lands scripted user presses, then pops its fault.
    pub fn begin_call(
        &mut self,
        method: FakeMethod,
        clock: &FakeClock,
    ) -> Result<CallOutcome, Refusal> {
        self.calls.record(method);
        clock.advance(self.scenario.delay_ms.for_method(method));
        let now = i64::try_from(clock.now_ms()).unwrap_or(i64::MAX);
        let (due, rest): (Vec<UserPress>, Vec<UserPress>) =
            std::mem::take(&mut self.pending_presses)
                .into_iter()
                .partition(|press| press.before == method);
        self.pending_presses = rest;
        self.user_inputs
            .extend(due.into_iter().map(|press| UserInput {
                at_ms: now,
                pid: press.pid,
                kind: press.kind,
            }));
        match self.faults.pop(method) {
            Fault::Pass => Ok(CallOutcome::Proceed),
            Fault::CannotComplete if method.is_ax_write() => Ok(CallOutcome::CannotComplete),
            Fault::CannotComplete => Ok(CallOutcome::Proceed),
            Fault::Fail { code, reason } => Err(Fault::refusal(code, reason)),
            Fault::RefuseFocus => Err(Refusal::new(
                EngineCode::InputFailed,
                Reason::ActivationRefused.wire(),
            )),
            Fault::Panic => panic!("scripted fault: the fake panics in {}", method.as_str()),
        }
    }

    /// Fires every script keyed on the call that just ended.
    pub fn end_call(&mut self, method: FakeMethod) {
        let nth = self.calls.count(method);
        let fires = |after: FakeMethod, at: u32| after == method && at == nth;
        let scenario = &self.scenario;
        for change in scenario
            .identity_changes
            .iter()
            .filter(|c| fires(c.after_call, c.nth))
        {
            if let Some(window) = self.windows.iter_mut().find(|w| w.id == change.window) {
                window.pid = change.new_pid;
            }
            self.process_start
                .insert(change.window.clone(), change.new_process_start);
        }
        for event in scenario
            .epoch_events
            .iter()
            .filter(|e| fires(e.after_call, e.nth))
        {
            self.epochs.push_back(EpochChange {
                reason: event.reason.as_str().to_owned(),
            });
        }
        if let Some(change) = scenario
            .displays_change
            .as_ref()
            .filter(|c| fires(c.after_call, c.nth))
        {
            self.displays.clone_from(&change.displays);
            self.epochs.push_back(EpochChange {
                reason: "display".to_owned(),
            });
        }
        for exit in scenario
            .target_exit
            .iter()
            .filter(|t| fires(t.after_call, t.nth))
        {
            self.exited.insert(exit.window.clone());
        }
    }

    /// A listed window whose process has not exited.
    pub fn live_window(&self, id: &str) -> Option<&FakeWindow> {
        self.windows
            .iter()
            .find(|window| window.id == id && !self.exited.contains(id))
    }
}
