//! The object-mode `Capabilities`: tier read, re-read on every call, never prompts.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::legacy::DeliveryMode;
use super::parts::{
    Availability, BackgroundBasis, BackgroundReach, CaptureCapability, DisplayAwake, InputMode,
    SessionProbes, ToolkitRoutes,
};
use crate::listing::SurfaceKind;
use crate::session_state::SessionState;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReleaseHelperReason {
    EnclosingJobNoBreakaway,
    WaylandReleaseUnproven,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ReleaseHelper {
    pub available: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<ReleaseHelperReason>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum RouteRung {
    Physical,
    Semantic,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SendOnEnterKeys {
    pub keys: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum StopPathKind {
    Global,
    HostRelay,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum DeafReason {
    SecureInputActive,
    PortalUnavailable,
    Xi2RawUnavailable,
    HookInstallFailed,
    ListenerParked,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StopPathCapability {
    pub kind: StopPathKind,
    pub host_relay_live: bool,
    pub allow_host_relay_only: bool,
    pub listener: String,
    pub deaf: bool,
    pub stale: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deaf_reason: Option<DeafReason>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum CompositorName {
    Mutter,
    Kwin,
    Sway,
    Hyprland,
    River,
    Labwc,
    Weston,
    Xfwm4,
    Openbox,
    I3,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum VirtualServer {
    Xvfb,
    Xvnc,
    Tigervnc,
}

/// The Linux compositor, declared once. `sessionLockProtocol` says the compositor
/// advertises `ext-session-lock-v1`; the lock datum itself is `session.screenLocked`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Compositor {
    pub name: CompositorName,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub nested: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub virtual_server: Option<VirtualServer>,
    pub session_lock_protocol: bool,
}

/// `capabilities` in an object-mode session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Capabilities {
    pub backend: String,
    pub display_count: u32,
    pub delivery_modes: Vec<DeliveryMode>,
    pub capture: CaptureCapability,
    pub window_capture: Availability,
    pub window_input: Availability,
    pub observe: bool,
    pub settle: bool,
    pub ocr: bool,
    #[serde(rename = "background_window_input")]
    pub background_window_input: bool,
    #[serde(rename = "background_window_input_basis")]
    pub background_window_input_basis: BackgroundBasis,
    pub input_modes: Vec<InputMode>,
    pub background_reach: BackgroundReach,
    pub toolkit_routes: ToolkitRoutes,
    pub session: SessionState,
    pub session_probes: SessionProbes,
    pub display_awake: DisplayAwake,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub release_helper: Option<ReleaseHelper>,
    pub surfaces: Vec<SurfaceKind>,
    pub route_ladder: Vec<RouteRung>,
    pub send_on_enter: SendOnEnterKeys,
    pub stop_path: StopPathCapability,
    /// Linux only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compositor: Option<Compositor>,
}
