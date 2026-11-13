//! The settings table: one row per `computer.*` key with its status, its reader and
//! whether it is a fingerprinted admission key. The reader test enumerates the schema
//! of [`super::Settings`] against these rows and reports 0 unread keys.

use serde::Serialize;

/// Where a key comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SettingStatus {
    /// A key users have today, kept.
    Keep,
    /// A key the contract adds.
    New,
    /// A former engine environment switch that moves into the table (design row C17).
    MovedFromEnv,
    /// Exists only until the cutover deletes the old implementation.
    MigrationOnly,
}

/// One row of the table.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingRow {
    /// The key under `computer.`; a nested member is written `group.member`.
    pub key: &'static str,
    pub status: SettingStatus,
    /// The stage that reads the key.
    pub reader: &'static str,
    /// A fingerprinted admission key: an edit outside the consent UI reads `tampered`.
    pub admission_key: bool,
}

const fn row(
    key: &'static str,
    status: SettingStatus,
    reader: &'static str,
    admission_key: bool,
) -> SettingRow {
    SettingRow {
        key,
        status,
        reader,
        admission_key,
    }
}

use SettingStatus::{Keep, MigrationOnly, MovedFromEnv, New};

/// The `computer.*` table in documentation order.
pub const SETTINGS_TABLE: &[SettingRow] = &[
    row("enabled", Keep, "tool registration", false),
    row("display", Keep, "session.open: display selector", false),
    row(
        "stop_hotkey",
        Keep,
        "session.open: stop listener chord",
        true,
    ),
    row(
        "allow_host_relay_only_stop",
        Keep,
        "session.open: StopPolicy.allowHostRelayOnly",
        true,
    ),
    row("audit_log", Keep, "session audit writer", false),
    row("screenshot_gc", Keep, "artifact GC", false),
    row(
        "engine_path",
        Keep,
        "engine locator (acquire source, identity-checked)",
        false,
    ),
    row(
        "send_on_enter",
        New,
        "session.open: send-on-enter composer guard",
        true,
    ),
    row(
        "url_policy",
        New,
        "session.open: Consequential gate URL read",
        true,
    ),
    row("run_limits", New, "QuickJS run cell ceilings", false),
    row("record", New, "per-run recording writer", true),
    row(
        "pause_ceiling_ms",
        New,
        "mutate admission: deadline pause",
        false,
    ),
    row(
        "display_awake_grace_ms",
        New,
        "session.open: display-awake hold",
        false,
    ),
    row(
        "display_awake_session_cap_ms",
        New,
        "session.open: display-awake hold",
        false,
    ),
    row(
        "x11_keymap_remap",
        New,
        "session.open: X11 backend keymap remap",
        true,
    ),
    row(
        "background_indicator",
        New,
        "hand host presence surface",
        true,
    ),
    row("max_width", Keep, "capture policy", false),
    row("max_height", Keep, "capture policy", false),
    row("screenshot_max_bytes", Keep, "capture policy", false),
    row("cua_adapter", Keep, "tool registration: CUA adapter", false),
    row("default_hand", New, "tool dispatcher: hand selector", false),
    row("mcp.tier", New, "--mcp host adapter consent view", false),
    row(
        "intervention",
        Keep,
        "session.open: intervention policy",
        true,
    ),
    row(
        "macos_key_priming",
        Keep,
        "session.open: macOS key priming",
        false,
    ),
    row("trace", Keep, "session.open: trace writer", false),
    row("remote_commands", New, "hand host admission", true),
    row(
        "foreground_input_lock",
        New,
        "presence surface: input lock",
        true,
    ),
    row("x11_mpx", New, "session.open: X11 MPX route", true),
    row(
        "wayland_persist_consent",
        New,
        "Wayland backend: portal token",
        false,
    ),
    row(
        "capture_on_open",
        New,
        "session.open: Wayland capture open",
        false,
    ),
    row("ssh_hosts", New, "brain-side SDK: ssh pipe", false),
    row(
        "fleet.maxInFlight",
        New,
        "brain-side SDK: fanout concurrency",
        false,
    ),
    row(
        "fleet.frameBytesPerMin",
        New,
        "brain-side SDK: fanout frame budget",
        false,
    ),
    row(
        "fleet.perHandFramesPerSec",
        New,
        "brain-side SDK: fanout frame rate",
        false,
    ),
    row(
        "fleet.maxImagePartsPerResult",
        New,
        "brain-side SDK: fanout image parts",
        false,
    ),
    row(
        "wayland_lease_end_chord",
        New,
        "session.open: Wayland lease-end chord",
        true,
    ),
    row(
        "linux_display_server",
        New,
        "session.open: Linux backend selection",
        false,
    ),
    row(
        "toolkit_routes",
        New,
        "session.open: route table loader",
        true,
    ),
    row(
        "artifact_max_bytes",
        New,
        "session.open: artifact GC cap",
        false,
    ),
    row(
        "artifact_max_files",
        New,
        "session.open: artifact GC cap",
        false,
    ),
    row(
        "artifact_release_after_fetch",
        New,
        "brain-side SDK: artifact release",
        false,
    ),
    row("capture_policy", New, "SDK capture policy", false),
    row("app_scope", New, "session.open: per-app scope", true),
    row("preview", New, "host preview consumer", false),
    row(
        "runtime",
        MigrationOnly,
        "runtime loader (legacy | v3)",
        false,
    ),
    row(
        "operation_timeout_ms",
        MovedFromEnv,
        "session.open: operation deadline",
        false,
    ),
    row(
        "close_timeout_ms",
        MovedFromEnv,
        "session.open: close budget",
        false,
    ),
    row(
        "capture_helper_signed",
        MovedFromEnv,
        "session.open: macOS capture helper trust",
        false,
    ),
];

/// The groups whose members are table rows of their own (`group.member`).
pub const GROUPED_KEYS: &[&str] = &["mcp", "fleet"];

/// The fingerprinted admission keys, in table order.
pub fn admission_keys() -> impl Iterator<Item = &'static str> {
    SETTINGS_TABLE
        .iter()
        .filter(|row| row.admission_key)
        .map(|row| row.key)
}
