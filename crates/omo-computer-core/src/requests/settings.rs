//! The reader of the `computer.*` settings table: it routes every key to the stage group
//! that consumes it (the reader column of `SETTINGS_TABLE`).

use super::session::{read_trace, TraceMode};
use crate::settings::{
    AppScope, AuditLog, CapturePolicyRow, CuaAdapter, ExactKeyTable, FleetSettings, HandSelector,
    Intervention, LinuxDisplayServer, McpSettings, RunLimits, Runtime, ScreenshotGc,
    SendOnEnterRule, Settings, SshHost, Tier, ToolkitClass,
};

/// Tool registration, the engine locator, the run cell and the dispatcher.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct HostConfig {
    pub enabled: Option<bool>,
    pub engine_path: Option<String>,
    pub cua_adapter: Option<CuaAdapter>,
    pub default_hand: Option<HandSelector>,
    pub mcp_tier: Option<Tier>,
    pub runtime: Option<Runtime>,
    pub run_limits: Option<RunLimits>,
}

/// Who can stop the hand, and how a lease ends.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct StopConfig {
    pub stop_hotkey: Option<String>,
    pub allow_host_relay_only_stop: Option<bool>,
    pub wayland_lease_end_chord: Option<String>,
}

/// The consent and admission gates.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ConsentConfig {
    pub send_on_enter: Option<ExactKeyTable<SendOnEnterRule>>,
    pub url_policy: Option<Vec<String>>,
    pub app_scope: Option<AppScope>,
    pub remote_commands: Option<bool>,
    pub toolkit_routes: Option<ExactKeyTable<ToolkitClass>>,
    pub intervention: Option<Intervention>,
    pub foreground_input_lock: Option<bool>,
    pub background_indicator: Option<bool>,
    pub record: Option<bool>,
}

/// Display selection and the capture policy.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CaptureConfig {
    pub display: Option<String>,
    pub max_width: Option<u32>,
    pub max_height: Option<u32>,
    pub screenshot_max_bytes: Option<u64>,
    pub capture_policy: Option<Vec<CapturePolicyRow>>,
    pub capture_on_open: Option<bool>,
    pub capture_helper_signed: Option<bool>,
    pub wayland_persist_consent: Option<bool>,
    pub linux_display_server: Option<LinuxDisplayServer>,
    pub preview: Option<bool>,
}

/// The per-OS input routes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct InputConfig {
    pub macos_key_priming: Option<bool>,
    pub x11_keymap_remap: Option<bool>,
    pub x11_mpx: Option<bool>,
}

/// Deadlines, pauses and the display-awake hold.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct TimingConfig {
    pub pause_ceiling_ms: Option<u64>,
    pub display_awake_grace_ms: Option<u64>,
    pub display_awake_session_cap_ms: Option<u64>,
    pub operation_timeout_ms: Option<u64>,
    pub close_timeout_ms: Option<u64>,
}

/// The audit, trace and artifact writers and their GC.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ArtifactConfig {
    pub audit_log: Option<AuditLog>,
    pub screenshot_gc: Option<ScreenshotGc>,
    pub artifact_max_bytes: Option<u64>,
    pub artifact_max_files: Option<u32>,
    pub artifact_release_after_fetch: Option<bool>,
    pub trace: Option<TraceMode>,
}

/// The brain-side fleet SDK.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct FleetConfig {
    pub ssh_hosts: Option<ExactKeyTable<SshHost>>,
    pub max_in_flight: Option<u32>,
    pub frame_bytes_per_min: Option<u64>,
    pub per_hand_frames_per_sec: Option<u32>,
    pub max_image_parts_per_result: Option<u32>,
}

/// The settings table routed to its consumers.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SessionConfig {
    pub host: HostConfig,
    pub stop: StopConfig,
    pub consent: ConsentConfig,
    pub capture: CaptureConfig,
    pub input: InputConfig,
    pub timing: TimingConfig,
    pub artifacts: ArtifactConfig,
    pub fleet: FleetConfig,
}

fn read_mcp(mcp: McpSettings) -> Tier {
    let McpSettings { tier } = mcp;
    tier
}

fn read_fleet(
    ssh_hosts: Option<ExactKeyTable<SshHost>>,
    fleet: Option<FleetSettings>,
) -> FleetConfig {
    let FleetSettings {
        max_in_flight,
        frame_bytes_per_min,
        per_hand_frames_per_sec,
        max_image_parts_per_result,
    } = fleet.unwrap_or_default();
    FleetConfig {
        ssh_hosts,
        max_in_flight,
        frame_bytes_per_min,
        per_hand_frames_per_sec,
        max_image_parts_per_result,
    }
}

#[must_use]
pub fn read_settings(settings: Settings) -> SessionConfig {
    let Settings {
        enabled,
        display,
        stop_hotkey,
        allow_host_relay_only_stop,
        audit_log,
        screenshot_gc,
        engine_path,
        send_on_enter,
        url_policy,
        run_limits,
        record,
        pause_ceiling_ms,
        display_awake_grace_ms,
        display_awake_session_cap_ms,
        x11_keymap_remap,
        background_indicator,
        max_width,
        max_height,
        screenshot_max_bytes,
        cua_adapter,
        default_hand,
        mcp,
        intervention,
        macos_key_priming,
        trace,
        remote_commands,
        foreground_input_lock,
        x11_mpx,
        wayland_persist_consent,
        capture_on_open,
        ssh_hosts,
        fleet,
        wayland_lease_end_chord,
        linux_display_server,
        toolkit_routes,
        artifact_max_bytes,
        artifact_max_files,
        artifact_release_after_fetch,
        capture_policy,
        app_scope,
        preview,
        runtime,
        operation_timeout_ms,
        close_timeout_ms,
        capture_helper_signed,
    } = settings;
    SessionConfig {
        host: HostConfig {
            enabled,
            engine_path,
            cua_adapter,
            default_hand,
            mcp_tier: mcp.map(read_mcp),
            runtime,
            run_limits,
        },
        stop: StopConfig {
            stop_hotkey,
            allow_host_relay_only_stop,
            wayland_lease_end_chord,
        },
        consent: ConsentConfig {
            send_on_enter,
            url_policy,
            app_scope,
            remote_commands,
            toolkit_routes,
            intervention,
            foreground_input_lock,
            background_indicator,
            record,
        },
        capture: CaptureConfig {
            display,
            max_width,
            max_height,
            screenshot_max_bytes,
            capture_policy,
            capture_on_open,
            capture_helper_signed,
            wayland_persist_consent,
            linux_display_server,
            preview,
        },
        input: InputConfig {
            macos_key_priming,
            x11_keymap_remap,
            x11_mpx,
        },
        timing: TimingConfig {
            pause_ceiling_ms,
            display_awake_grace_ms,
            display_awake_session_cap_ms,
            operation_timeout_ms,
            close_timeout_ms,
        },
        artifacts: ArtifactConfig {
            audit_log,
            screenshot_gc,
            artifact_max_bytes,
            artifact_max_files,
            artifact_release_after_fetch,
            trace: trace.map(read_trace),
        },
        fleet: read_fleet(ssh_hosts, fleet),
    }
}
