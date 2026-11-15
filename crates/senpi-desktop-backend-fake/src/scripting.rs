//! Scenario shapes the v2 behavior rows script: window identity and its
//! changes, key-priming focus reads and record effects, hit reads, the user's
//! input timeline, partial-observation knobs, epoch events, a display change,
//! and a stop marker. Every field defaults to today's behavior.

use senpi_desktop_core::types::DesktopDisplay;
use serde::Deserialize;

use crate::method::FakeMethod;
use crate::user_input_impl::ScriptedPressKind;

/// What a window's owning process reports about itself:
/// `{"processStart": 1700000000}`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FakeWindowIdentity {
    #[serde(rename = "processStart")]
    pub process_start: u64,
}

/// One identity read: the window's owning pid and when that process started.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FakeIdentityRead {
    pub pid: u32,
    pub process_start: u64,
}

/// From the fake call after the `nth` call of `after_call`, window `window`
/// belongs to `new_pid`, which started at `new_processStart`, as when an app
/// quits and a new process reuses the window id.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IdentityChange {
    pub after_call: FakeMethod,
    #[serde(default = "first_call")]
    pub nth: u32,
    pub window: String,
    pub new_pid: u32,
    #[serde(rename = "new_processStart")]
    pub new_process_start: u64,
}

/// One key-priming focus read for `window`: the window the system reports as
/// focused and the window of the focused element. `None` means the read
/// found nothing. Reads for a window are served in scenario order.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FakeFocusRead {
    pub window: String,
    #[serde(default)]
    pub focused_window: Option<String>,
    #[serde(default)]
    pub focused_element_window: Option<String>,
}

/// The focus records a key-priming backend can post.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FocusRecordKind {
    /// Focus + make-key records addressed to the target pid.
    Short,
    /// The full record form.
    Full,
    /// The accessibility `AXFocusedWindow` write.
    AxWrite,
}

/// What one focus record did.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FocusRecordOutcome {
    /// The target window became focused, element focus included.
    TookEffect,
    /// The record went out and changed nothing.
    NoEffect,
    /// The record could not be posted.
    Failed,
}

/// The accessibility element under a global logical point. `secure` marks a
/// secure text field; the backend reports its label as scripted.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FakeHit {
    pub x: f64,
    pub y: f64,
    pub role: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub secure: bool,
}

/// A user press at `t_ms` milliseconds relative to backend creation:
/// negative is in the past, positive becomes visible to the feed once that
/// time has passed.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TimedUserPress {
    pub t_ms: i64,
    pub pid: u32,
    #[serde(default = "click")]
    pub kind: ScriptedPressKind,
}

/// Why the backend's coordinate epoch moved.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EpochReason {
    Display,
    Lock,
    Sleep,
    Space,
    Restart,
}

/// From the fake call after the `nth` call of `after_call`, the epoch moves
/// for `reason`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EpochEvent {
    pub after_call: FakeMethod,
    #[serde(default = "first_call")]
    pub nth: u32,
    pub reason: EpochReason,
}

/// From the fake call after the `nth` call of `after_call`, the host serves
/// `displays`, and the epoch moves for [`EpochReason::Display`], as a display
/// reconfiguration callback reports both.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DisplaysChange {
    pub after_call: FakeMethod,
    #[serde(default = "first_call")]
    pub nth: u32,
    pub displays: Vec<DesktopDisplay>,
}

const fn first_call() -> u32 {
    1
}

const fn click() -> ScriptedPressKind {
    ScriptedPressKind::Click
}

/// A timeline entry waiting for its trigger call, then for the next call.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum TimelineEvent {
    Identity(IdentityChange),
    Epoch(EpochReason),
    Displays(Vec<DesktopDisplay>),
}

/// Counts every fake call and releases the scripted events whose trigger
/// call has run: an event fires at the start of the call after its trigger.
#[derive(Debug, Default)]
pub(crate) struct Timeline {
    calls: std::collections::BTreeMap<FakeMethod, u32>,
    waiting: Vec<(FakeMethod, u32, TimelineEvent)>,
    due: Vec<TimelineEvent>,
}

impl Timeline {
    pub(crate) fn new(waiting: Vec<(FakeMethod, u32, TimelineEvent)>) -> Self {
        Self {
            waiting,
            ..Self::default()
        }
    }

    /// Events due now, then counts `method`'s call and arms the events it
    /// triggers for the next call.
    pub(crate) fn advance(&mut self, method: FakeMethod) -> Vec<TimelineEvent> {
        let due = std::mem::take(&mut self.due);
        let count = self.calls.entry(method).or_insert(0);
        *count = count.saturating_add(1);
        let count = *count;
        let (now, later): (Vec<_>, Vec<_>) = std::mem::take(&mut self.waiting)
            .into_iter()
            .partition(|(after, nth, _)| *after == method && *nth == count);
        self.waiting = later;
        self.due = now.into_iter().map(|(_, _, event)| event).collect();
        due
    }
}
