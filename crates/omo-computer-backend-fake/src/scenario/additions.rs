//! The record shapes of the fields the v3 rows add to the scenario format.

use serde::Deserialize;

use crate::method::FakeMethod;

/// One observer event at fake-clock time `t_ms` after backend creation.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AxNotification {
    pub t_ms: u64,
    pub window: String,
    /// The OS notification name (`AXValueChanged`, `object:children-changed`, ...).
    pub kind: String,
    /// The window leaves the listing when this event fires (it closed). A destroyed child of a
    /// window raises the same notification on macOS and leaves the window listed.
    #[serde(default)]
    pub closes: bool,
}

/// From `t_ms` on, the window shows (or stops showing) a loading indicator.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BusyMark {
    pub t_ms: u64,
    pub window: String,
    pub busy: bool,
    #[serde(default)]
    pub indicator: Option<String>,
}

/// The user presses the stop chord at fake-clock time `t_ms` after backend creation. The press
/// fires when the fake's observer wait moves the clock past it (a settle or busy wait).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StopPress {
    pub t_ms: u64,
}

/// One notification the notification surface lists from fake-clock time `t_ms` on.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NotificationPost {
    pub t_ms: u64,
    pub app: String,
    pub title: String,
    pub body: String,
}

/// The focused element of `window` is a secure field.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SecureFocus {
    pub window: String,
    pub role: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ClipboardScript {
    #[serde(default)]
    pub text: Option<String>,
    /// The OS marks the content concealed (a password manager's copy).
    #[serde(default)]
    pub concealed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FrameAxis {
    X,
    Y,
    Width,
    Height,
}

/// What the window manager does with a frame request on this window.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FramePolicy {
    /// Axes the window keeps whatever is asked.
    #[serde(default)]
    pub keep: Vec<FrameAxis>,
    /// `false`: the position cannot be set at all.
    #[serde(default)]
    pub settable: Option<bool>,
}

/// After the `nth` call of `after_call` the window's process exits.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TargetExit {
    pub after_call: FakeMethod,
    #[serde(default = "first")]
    pub nth: u32,
    pub window: String,
}

const fn first() -> u32 {
    1
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HandIdentity {
    pub id: String,
    pub machine_id: String,
}
