use super::MacosBackend;
use crate::{ax::is_trusted, input::CANARY_STOP_REASON};
use senpi_desktop_core::types::DesktopCapabilities;

impl MacosBackend {
    /// Runtime truth from the TCC preflights and the SkyLight probe; never
    /// prompts and never pops the canary dialog.
    pub fn capabilities(&self) -> DesktopCapabilities {
        let capture_permission = self.capture.permission_granted();
        let trusted = is_trusted();
        let display_count = if capture_permission {
            self.capture.displays().map_or(0, |displays| {
                u32::try_from(displays.len()).unwrap_or(u32::MAX)
            })
        } else {
            0
        };
        let canary_failed = self.input.canary_failed();
        DesktopCapabilities {
            backend: "quartz".to_string(),
            display_server: Some("Quartz WindowServer".to_string()),
            capture: capture_permission && display_count > 0,
            input: trusted,
            ax: trusted,
            background_window_input: trusted && crate::skylight::is_available() && !canary_failed,
            cursor_overlay: self.overlay_available(),
            delivery_modes: vec!["background".to_string(), "foreground".to_string()],
            capture_permission: permission_label(capture_permission),
            input_permission: permission_label(trusted),
            ax_permission: permission_label(trusted),
            display_count,
            focus_guard: true,
            stop_reason: canary_failed.then(|| CANARY_STOP_REASON.to_string()),
            legacy_capture: self.capture.legacy_capture(),
            ..DesktopCapabilities::unavailable()
        }
    }
}

fn permission_label(granted: bool) -> String {
    if granted { "granted" } else { "denied" }.to_string()
}
