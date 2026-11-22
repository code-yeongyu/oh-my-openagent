//! The fake's v2 scripting hooks: identity, focus reads and records, hit
//! reads, the frontmost pid, epochs, and the call timeline that fires
//! identity changes, epoch events, and the display change.

use std::collections::{BTreeMap, VecDeque};

use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::types::DesktopPoint;

use crate::fake::FakeBackend;
use crate::method::FakeMethod;
use crate::scenario::FakeScenario;
use crate::scripting::{
    EpochReason, FakeFocusRead, FakeHit, FakeIdentityRead, FakeWindowIdentity, FocusRecordKind,
    FocusRecordOutcome, Timeline, TimelineEvent,
};
use crate::sink::SinkOp;

/// How far a hit read's point may sit from a scripted hit, in logical points.
const HIT_TOLERANCE: f64 = 0.5;

#[derive(Debug, Default)]
pub(crate) struct Scripted {
    identity: BTreeMap<String, FakeWindowIdentity>,
    focus_reads: Vec<FakeFocusRead>,
    focus_record_effects: BTreeMap<FocusRecordKind, VecDeque<FocusRecordOutcome>>,
    hit_at: Vec<FakeHit>,
    frontmost_pid: Option<u32>,
    ax_deadline_ms: Option<u64>,
    stop_marker: Option<String>,
    epoch: u64,
    timeline: Timeline,
}

impl Scripted {
    /// Takes the scripting fields out of `scenario`.
    pub(crate) fn new(scenario: &mut FakeScenario) -> Self {
        let mut waiting: Vec<_> = std::mem::take(&mut scenario.identity_changes)
            .into_iter()
            .map(|change| {
                (
                    change.after_call,
                    change.nth,
                    TimelineEvent::Identity(change),
                )
            })
            .collect();
        waiting.extend(
            std::mem::take(&mut scenario.epoch_events)
                .into_iter()
                .map(|event| {
                    (
                        event.after_call,
                        event.nth,
                        TimelineEvent::Epoch(event.reason),
                    )
                }),
        );
        waiting.extend(scenario.displays_change.take().map(|change| {
            (
                change.after_call,
                change.nth,
                TimelineEvent::Displays(change.displays),
            )
        }));
        Self {
            identity: std::mem::take(&mut scenario.identity),
            focus_reads: std::mem::take(&mut scenario.focus_reads),
            focus_record_effects: std::mem::take(&mut scenario.focus_record_effects)
                .into_iter()
                .map(|(kind, outcomes)| (kind, outcomes.into()))
                .collect(),
            hit_at: std::mem::take(&mut scenario.hit_at),
            frontmost_pid: scenario.frontmost_pid,
            ax_deadline_ms: scenario.ax_deadline_ms,
            stop_marker: scenario.stop_marker.take(),
            epoch: 0,
            timeline: Timeline::new(waiting),
        }
    }
}

impl FakeBackend {
    /// Fires the timeline events due before this call of `method`.
    pub(crate) fn advance_timeline(&mut self, method: FakeMethod) {
        for event in self.scripted.timeline.advance(method) {
            match event {
                TimelineEvent::Identity(change) => {
                    self.change_identity(&change.window, change.new_pid, change.new_process_start)
                }
                TimelineEvent::Epoch(reason) => self.bump_epoch(reason),
                TimelineEvent::Displays(displays) => {
                    self.capabilities.display_count =
                        u32::try_from(displays.len()).unwrap_or(u32::MAX);
                    self.displays = displays;
                    self.record(SinkOp::DisplaysChanged {
                        count: self.displays.len(),
                    });
                    self.bump_epoch(EpochReason::Display);
                }
            }
        }
    }

    fn change_identity(&mut self, window: &str, new_pid: u32, process_start: u64) {
        let Some(entry) = self
            .windows
            .iter_mut()
            .find(|candidate| candidate.id == window)
        else {
            return;
        };
        let old_pid = entry.pid.replace(new_pid);
        self.scripted
            .identity
            .insert(window.to_owned(), FakeWindowIdentity { process_start });
        self.user_input.set_started(new_pid, process_start);
        self.record(SinkOp::IdentityChanged {
            window: window.to_owned(),
            old_pid,
            new_pid,
            process_start,
        });
    }

    /// The owning pid of `window` and when that process started; `None` when
    /// the scenario scripts no identity for it or it has no pid.
    pub fn window_identity(&mut self, window: &str) -> CoreResult<Option<FakeIdentityRead>> {
        self.begin(FakeMethod::WindowIdentity)?;
        let pid = self.window(window)?.pid;
        let identity = pid
            .zip(self.scripted.identity.get(window))
            .map(|(pid, identity)| FakeIdentityRead {
                pid,
                process_start: identity.process_start,
            });
        self.record(SinkOp::IdentityRead {
            window: window.to_owned(),
            identity,
        });
        Ok(identity)
    }

    /// The next scripted key-priming focus read for `window`; once those run
    /// out, the focused window answers both reads.
    pub fn read_focus(&mut self, window: &str) -> CoreResult<FakeFocusRead> {
        self.begin(FakeMethod::FocusRead)?;
        self.window(window)?;
        let read = match self
            .scripted
            .focus_reads
            .iter()
            .position(|read| read.window == window)
        {
            Some(index) => self.scripted.focus_reads.remove(index),
            None => {
                let focused = self
                    .windows
                    .iter()
                    .find(|candidate| candidate.focused)
                    .map(|w| w.id.clone());
                FakeFocusRead {
                    window: window.to_owned(),
                    focused_window: focused.clone(),
                    focused_element_window: focused,
                }
            }
        };
        self.record(SinkOp::FocusRead(read.clone()));
        Ok(read)
    }

    /// Posts one focus record of `kind` at `window`. The scripted outcome
    /// decides what it does; unscripted records take effect.
    pub fn record_focus(
        &mut self,
        kind: FocusRecordKind,
        window: &str,
    ) -> CoreResult<FocusRecordOutcome> {
        self.begin(FakeMethod::FocusRecord)?;
        self.window(window)?;
        let outcome = self
            .scripted
            .focus_record_effects
            .get_mut(&kind)
            .and_then(VecDeque::pop_front)
            .unwrap_or(FocusRecordOutcome::TookEffect);
        if outcome == FocusRecordOutcome::TookEffect {
            self.focus_window(window);
        }
        self.record(SinkOp::FocusRecord {
            kind,
            window: window.to_owned(),
            outcome,
        });
        match outcome {
            FocusRecordOutcome::Failed => Err(DesktopError::input_failed(format!(
                "scripted {kind:?} focus record at window {window} failed"
            ))),
            FocusRecordOutcome::TookEffect | FocusRecordOutcome::NoEffect => Ok(outcome),
        }
    }

    /// The scripted element under the global logical point, if any.
    pub fn hit_read(&mut self, at: DesktopPoint) -> CoreResult<Option<FakeHit>> {
        self.begin(FakeMethod::HitRead)?;
        let hit = self
            .scripted
            .hit_at
            .iter()
            .find(|hit| {
                (hit.x - at.x).abs() <= HIT_TOLERANCE && (hit.y - at.y).abs() <= HIT_TOLERANCE
            })
            .cloned();
        self.record(SinkOp::HitRead {
            at,
            hit: hit.clone(),
        });
        Ok(hit)
    }

    /// The frontmost app's pid: scripted, else the focused window's.
    pub fn frontmost_pid(&mut self) -> CoreResult<Option<u32>> {
        self.begin(FakeMethod::FrontmostPid)?;
        let pid = self.front_pid();
        self.record(SinkOp::FrontmostRead { pid });
        Ok(pid)
    }

    /// [`Self::frontmost_pid`]'s answer, with no call recorded.
    pub(crate) fn front_pid(&self) -> Option<u32> {
        self.scripted.frontmost_pid.or_else(|| {
            self.windows
                .iter()
                .find(|window| window.focused)
                .and_then(|window| window.pid)
        })
    }

    /// Moves the coordinate epoch, as a host event would.
    pub fn bump_epoch(&mut self, reason: EpochReason) {
        self.scripted.epoch = self.scripted.epoch.saturating_add(1);
        self.record(SinkOp::EpochBumped {
            epoch: self.scripted.epoch,
            reason,
        });
    }

    /// How many times the epoch has moved.
    pub const fn epoch(&self) -> u64 {
        self.scripted.epoch
    }

    pub const fn ax_deadline_ms(&self) -> Option<u64> {
        self.scripted.ax_deadline_ms
    }

    /// The stop marker path present at engine start, if any.
    pub fn stop_marker(&self) -> Option<&str> {
        self.scripted.stop_marker.as_deref()
    }
}
