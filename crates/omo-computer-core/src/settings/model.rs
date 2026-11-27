//! `Settings`: the `computer.*` table as `session.open{settings}` carries it.
//!
//! Every key is optional: the host resolves defaults, and a remote hand reads its own
//! table. Unknown keys are refused (the strict schema).

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::limits::{FleetSettings, McpSettings, RunLimits};
use super::values::{
    AppScope, AuditLog, CapturePolicyRow, CuaAdapter, ExactKeyTable, HandSelector, Intervention,
    LinuxDisplayServer, Runtime, ScreenshotGc, SendOnEnterRule, SshHost, ToolkitClass, Trace,
};

macro_rules! optional_settings {
    ($(#[$meta:meta])* pub struct $name:ident { $($field:ident: $ty:ty,)+ }) => {
        $(#[$meta])*
        #[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, JsonSchema)]
        #[serde(deny_unknown_fields)]
        pub struct $name {
            $(
                #[serde(default, skip_serializing_if = "Option::is_none")]
                pub $field: Option<$ty>,
            )+
        }
    };
}

optional_settings! {
    /// The one documented `computer.*` table; [`super::SETTINGS_TABLE`] names each key's reader.
    pub struct Settings {
        enabled: bool,
        display: String,
        stop_hotkey: String,
        allow_host_relay_only_stop: bool,
        audit_log: AuditLog,
        screenshot_gc: ScreenshotGc,
        engine_path: String,
        send_on_enter: ExactKeyTable<SendOnEnterRule>,
        url_policy: Vec<String>,
        run_limits: RunLimits,
        record: bool,
        pause_ceiling_ms: u64,
        display_awake_grace_ms: u64,
        display_awake_session_cap_ms: u64,
        x11_keymap_remap: bool,
        background_indicator: bool,
        max_width: u32,
        max_height: u32,
        screenshot_max_bytes: u64,
        cua_adapter: CuaAdapter,
        default_hand: HandSelector,
        mcp: McpSettings,
        intervention: Intervention,
        macos_key_priming: bool,
        trace: Trace,
        remote_commands: bool,
        foreground_input_lock: bool,
        x11_mpx: bool,
        wayland_persist_consent: bool,
        capture_on_open: bool,
        ssh_hosts: ExactKeyTable<SshHost>,
        fleet: FleetSettings,
        wayland_lease_end_chord: String,
        linux_display_server: LinuxDisplayServer,
        toolkit_routes: ExactKeyTable<ToolkitClass>,
        artifact_max_bytes: u64,
        artifact_max_files: u32,
        artifact_release_after_fetch: bool,
        capture_policy: Vec<CapturePolicyRow>,
        app_scope: AppScope,
        preview: bool,
        runtime: Runtime,
        operation_timeout_ms: u64,
        close_timeout_ms: u64,
        capture_helper_signed: bool,
    }
}
