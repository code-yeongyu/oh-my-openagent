//! Member types of the object-mode `Capabilities`, one spelling each.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::settings::ToolkitClass;

/// `{available, reason?}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Availability {
    pub available: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// How a frame was produced.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum CaptureRoute {
    Composite,
    RootCrop,
    Screencast,
    ScreencastCrop,
    ScreenshotPortal,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CaptureCapability {
    pub available: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub route: Option<CaptureRoute>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum BackgroundBasis {
    Receipt,
    CrossProcessVerified,
    RouteAvailable,
    Unverified,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum InputMode {
    Pointer,
    Keyboard,
    Ax,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum BackgroundReach {
    Full,
    PointerOnly,
    CoreToolkitsOnly,
    Win32ClassicOnly,
    AxOnly,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SeededRoute {
    pub key: String,
    pub class: ToolkitClass,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub enum LearnedSource {
    #[serde(rename = "learned")]
    Learned,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub enum DefaultDelivery {
    #[serde(rename = "foreground_lease_first")]
    ForegroundLeaseFirst,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LearnedRoute {
    pub key: String,
    pub source: LearnedSource,
    pub default_delivery: DefaultDelivery,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ToolkitRoutes {
    pub seeded: Vec<SeededRoute>,
    pub learned: Vec<LearnedRoute>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthMessage {
    pub offset: u8,
    pub sentinel_at: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct AuthMessageProbe {
    pub hits: Vec<u8>,
}

/// The OS symbol or protocol behind each `SessionState` field (`"none"` where there is none).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionProbes {
    pub screen_locked: String,
    pub display_asleep: String,
    pub user_active: String,
    pub secure_input_active: String,
    pub session_active: String,
    pub screensaver_active: String,
    pub session_active_delivery_verified: bool,
    /// macOS only: absent elsewhere, `null` when no candidate accepted.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        with = "crate::nullable"
    )]
    #[schemars(with = "Option<AuthMessage>")]
    pub auth_message: Option<Option<AuthMessage>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth_message_probe: Option<AuthMessageProbe>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum DisplayAwakeState {
    Idle,
    Held,
    Released,
    Capped,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub enum DisplayAwakeMechanism {
    #[serde(rename = "IOPMAssertion")]
    IopmAssertion,
    PowerRequest,
    XResetScreenSaver,
    #[serde(rename = "idle-inhibit")]
    IdleInhibit,
    #[serde(rename = "ScreenSaver.Inhibit")]
    ScreenSaverInhibit,
    #[serde(rename = "unavailable")]
    Unavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DisplayAwake {
    pub state: DisplayAwakeState,
    pub grace_ms: u64,
    pub cap_ms: u64,
    pub held_since_ms: Option<u64>,
    pub mechanism: DisplayAwakeMechanism,
}
