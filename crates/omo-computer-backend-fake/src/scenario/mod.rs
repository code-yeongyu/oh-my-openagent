//! The scenario format the fixtures use. Top-level keys are `snake_case`; an unknown key at any
//! depth is a typed [`ScenarioInvalid`] naming its JSON pointer, and no backend is built.

mod additions;
mod closed;
mod events;
mod invalid;
mod records;
mod references;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use omo_computer_core::listing::CodeIdentity;
use omo_computer_core::params::Point;
use serde::Deserialize;
use serde_json::Value;

pub use additions::{AxNotification, BusyMark, ClipboardScript, FrameAxis, FramePolicy, HandIdentity, NotificationPost, SecureFocus, StopPress, TargetExit};
pub use events::{DisplaysChange, EpochEvent, EpochReason, IdentityChange};
pub use invalid::{field_names, InvalidKind, ScenarioInvalid};
pub use records::{
    DelayMs, FakeAxNode, FakeDisplay, FakeMenuNode, FakeWindow, FocusRead, FocusRecordKind,
    FocusRecordOutcome, RemoteForwarding, ScriptedFailure, ScriptedHit, TimedUserInput,
    UserInputKind, UserPress, WindowIdentityScript,
};

use crate::method::FakeMethod;
use crate::persona::Persona;

/// One parsed scenario: the imported fields first, then the fields the v3 rows add.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct FakeScenario {
    pub displays: Vec<FakeDisplay>,
    pub windows: Vec<FakeWindow>,
    /// Accessibility tree root per window id.
    pub ax: BTreeMap<String, FakeAxNode>,
    /// AX writes whose completion is never answered, in order.
    pub ax_cannot_complete: Vec<FakeMethod>,
    /// The deadline a partial accessibility walk honours.
    pub ax_deadline_ms: Option<u64>,
    /// Pads a window's tree with leaves up to this many nodes in total.
    pub ax_node_count: BTreeMap<String, u32>,
    /// Later versions of a window's tree: root read `k` (from 2) serves version `k - 1`, the
    /// last one after that.
    pub ax_versions: BTreeMap<String, Vec<FakeAxNode>>,
    pub cursor: Option<Point>,
    /// Fake-clock milliseconds a call costs before it runs.
    pub delay_ms: DelayMs,
    pub displays_change: Option<DisplaysChange>,
    pub epoch_events: Vec<EpochEvent>,
    /// Faults queued at load, as if injected in order.
    pub fail_next: Vec<ScriptedFailure>,
    pub focus_reads: Vec<FocusRead>,
    pub focus_record_effects: BTreeMap<FocusRecordKind, Vec<FocusRecordOutcome>>,
    pub frontmost_pid: Option<u32>,
    pub hit_at: Vec<ScriptedHit>,
    pub identity: BTreeMap<String, WindowIdentityScript>,
    pub identity_changes: Vec<IdentityChange>,
    pub legacy_capture: bool,
    pub menus: BTreeMap<String, Vec<FakeMenuNode>>,
    pub remote_screens: BTreeMap<u32, RemoteForwarding>,
    pub stop_marker: Option<String>,
    pub user_input_timeline: Vec<TimedUserInput>,
    pub user_presses: Vec<UserPress>,
    /// The OS the fake plays; absent follows the host.
    pub persona: Option<Persona>,
    /// Observer events by fake-clock time: the quiet window the settle waits on.
    pub ax_notification_timeline: Vec<AxNotification>,
    /// Loading indicators by fake-clock time.
    pub busy_timeline: Vec<BusyMark>,
    /// Stop-chord presses by fake-clock time.
    pub stop_timeline: Vec<StopPress>,
    /// Notifications by fake-clock time; absent scripts a host with no notification surface.
    pub notification_timeline: Option<Vec<NotificationPost>>,
    pub secure_focus: Option<SecureFocus>,
    pub secure_input_on: bool,
    pub clipboard: Option<ClipboardScript>,
    /// `false` scripts a host without a presence surface; absent has one.
    pub presence_surface: Option<bool>,
    pub preview_subscribed: bool,
    /// Pids of the engine's own chain (terminal, host, engine).
    pub self_set: Vec<u32>,
    /// Frame-verb results per window: kept axes and immovable windows.
    pub window_frame_policy: BTreeMap<String, FramePolicy>,
    /// Keys the user holds physically at start.
    pub held_keys: Vec<String>,
    pub full_access_preset: bool,
    pub target_exit: Vec<TargetExit>,
    /// Window id -> the session or hand that holds its reservation.
    pub window_reservation: BTreeMap<String, String>,
    /// Signed code identity per pid.
    pub code_identity: BTreeMap<u32, CodeIdentity>,
    /// The hand identity the fleet harness reads.
    pub hand: Option<HandIdentity>,
    // --- Row 21: the fake host's consent view handed to the engine at `session.open`. ---
    pub consent: Option<serde_json::Value>,
    // --- Row 21 (review M3): the executable path per pid a path-only consent binds to. ---
    pub executable_path: BTreeMap<u32, String>,
    // --- Row 21 (R70av): chords the fake's set_stop_chord refuses (default: none). ---
    pub unarmable_stop_chords: Vec<String>,
}

impl FakeScenario {
    /// # Errors
    /// [`ScenarioInvalid`] with the pointer of the first problem.
    pub fn from_json(json: &str) -> Result<Self, ScenarioInvalid> {
        let value: Value = serde_json::from_str(json).map_err(|error| ScenarioInvalid {
            kind: InvalidKind::Syntax,
            pointer: String::new(),
            reason: error.to_string(),
        })?;
        Self::from_value(&value)
    }

    /// # Errors
    /// [`ScenarioInvalid`] with the pointer of the first problem.
    pub fn from_value(value: &Value) -> Result<Self, ScenarioInvalid> {
        if !value.is_object() {
            return Err(ScenarioInvalid {
                kind: InvalidKind::Shape,
                pointer: String::new(),
                reason: "the scenario root must be a JSON object".to_owned(),
            });
        }
        let scenario =
            Self::deserialize(value).map_err(|error| invalid::from_serde(value, &error))?;
        references::check(&scenario)?;
        Ok(scenario)
    }

    /// # Errors
    /// The file cannot be read, or [`ScenarioInvalid`].
    pub fn load(path: &Path) -> Result<Self, ScenarioInvalid> {
        let json = std::fs::read_to_string(path).map_err(|error| ScenarioInvalid {
            kind: InvalidKind::Read,
            pointer: String::new(),
            reason: format!("{}: {error}", path.display()),
        })?;
        Self::from_json(&json)
    }
}

/// The directory of the scenario fixtures.
#[must_use]
pub fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures")
}

#[cfg(test)]
mod field_lint;
#[cfg(test)]
mod ported_tests;
#[cfg(test)]
mod tests;
