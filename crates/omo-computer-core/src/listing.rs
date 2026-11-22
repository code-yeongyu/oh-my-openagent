//! The declared listing records of the contract (acceptance 88): `WindowInfo`,
//! `ElementInfo`, `AppInfo` and `Surface`. Each carries `observation.untrustedText:true`
//! because titles, labels and values are app-chosen strings.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::untrusted::UntrustedText;

/// A rectangle in the coordinate space of the reply that carries it.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// A window's identity: the OS handle plus the process generation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowIdentity {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window_number: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hwnd: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub xid: Option<u32>,
    pub pid: u32,
    pub process_start: u64,
}

/// One `windows()` record: minimized windows are listed, never filtered.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowInfo {
    pub id: String,
    pub identity: WindowIdentity,
    pub app: String,
    /// Bundle id, AUMID, `WM_CLASS` or `app_id`.
    pub app_key: String,
    pub title: String,
    pub bounds: Rect,
    pub display: String,
    pub focused: bool,
    pub is_on_screen: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub space: Option<String>,
    pub minimized: bool,
    pub elevated: bool,
    /// Front-to-back index of the listing order.
    pub z: u32,
    pub observation: UntrustedText,
}

/// One accessibility element as a tree, `find()`, `elementAt()` or a menu shows it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ElementInfo {
    #[serde(rename = "ref")]
    pub reference: String,
    pub role: String,
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub native_role: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub focused: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub child_count: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds: Option<Rect>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actions: Option<Vec<String>>,
    pub window: String,
    pub generation: u64,
    pub observation: UntrustedText,
}

/// Where an `apps.list()` entry came from on this OS.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum AppSource {
    Running,
    XdgEntry,
    AppPaths,
    StartMenu,
    AppsFolder,
    LaunchServices,
}

/// The code identity consent is bound to (principle 6).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CodeIdentity {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub team_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cdhash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signer: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hash: Option<String>,
}

/// One `apps.list()` record.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppInfo {
    pub app_key: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    pub running: bool,
    pub source: AppSource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identity: Option<CodeIdentity>,
    pub observation: UntrustedText,
}

/// The nineteen system surface kinds; `capabilities().surfaces` lists this OS's subset.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SurfaceKind {
    Window,
    Focused,
    Menu,
    Menubar,
    Sheet,
    Popover,
    Alert,
    Desktop,
    Taskbar,
    SystemTray,
    QuickSettings,
    NotificationCenter,
    Toolbar,
    Dock,
    Spotlight,
    MenubarExtras,
    SystemTrayOverflow,
    StartMenu,
    ActionCenter,
}

/// One system or app surface.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Surface {
    pub kind: SurfaceKind,
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds: Option<Rect>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub observation: UntrustedText,
}
