//! The record shapes of the imported scenario fields.

use std::collections::BTreeMap;

use omo_computer_core::listing::Rect;
use serde::Deserialize;

use omo_computer_core::error::{EngineCode, Reason};

use super::closed;
use crate::method::FakeMethod;

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FakeDisplay {
    pub id: String,
    pub name: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub scale: f64,
    pub pixel_x: f64,
    pub pixel_y: f64,
    pub pixel_width: f64,
    pub pixel_height: f64,
    pub is_primary: bool,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FakeWindow {
    pub id: String,
    pub title: String,
    pub app: String,
    pub pid: u32,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub focused: bool,
    pub elevated: Option<bool>,
}

impl FakeWindow {
    #[must_use]
    pub const fn bounds(&self) -> Rect {
        Rect {
            x: self.x,
            y: self.y,
            width: self.width,
            height: self.height,
        }
    }
}

/// One scripted accessibility element and its subtree.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FakeAxNode {
    pub role: String,
    #[serde(default)]
    pub native_role: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub value: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub focused: bool,
    #[serde(default)]
    pub bounds: Option<Rect>,
    #[serde(default)]
    pub actions: Vec<String>,
    #[serde(default)]
    pub children: Vec<Self>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FakeMenuNode {
    pub title: String,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub checked: bool,
    #[serde(default)]
    pub shortcut: Option<String>,
    #[serde(default)]
    pub children: Vec<Self>,
}

/// One cost for every call, or a cost per method (`{"capture": 5000}`).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(untagged)]
pub enum DelayMs {
    Every(u64),
    PerMethod(BTreeMap<FakeMethod, u64>),
}

impl Default for DelayMs {
    fn default() -> Self {
        Self::PerMethod(BTreeMap::new())
    }
}

impl DelayMs {
    #[must_use]
    pub fn for_method(&self, method: FakeMethod) -> u64 {
        match self {
            Self::Every(ms) => *ms,
            Self::PerMethod(map) => map.get(&method).copied().unwrap_or(0),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScriptedFailure {
    pub method: FakeMethod,
    /// One of the closed engine codes.
    #[serde(deserialize_with = "closed::engine_code")]
    pub code: EngineCode,
    /// A token of the closed reason vocabulary; absent keys the code's bare row.
    #[serde(default, deserialize_with = "closed::reason")]
    pub reason: Option<Reason>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UserInputKind {
    Click,
    Key,
    Scroll,
    Pointer,
}

/// A user press that lands right before the next call of `before`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UserPress {
    pub before: FakeMethod,
    pub pid: u32,
    pub kind: UserInputKind,
}

/// A user input at fake-clock time `t_ms` after backend creation (negative: before it).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TimedUserInput {
    pub t_ms: i64,
    pub pid: u32,
    pub kind: UserInputKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RemoteForwarding {
    KeyEvents,
    HidReports,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowIdentityScript {
    pub process_start: u64,
}

/// One key-priming focus read, served per window in order.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FocusRead {
    pub window: String,
    pub focused_window: String,
    pub focused_element_window: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FocusRecordKind {
    Short,
    Full,
    AxWrite,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FocusRecordOutcome {
    NoEffect,
    TookEffect,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScriptedHit {
    pub x: f64,
    pub y: f64,
    pub role: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub secure: bool,
}
