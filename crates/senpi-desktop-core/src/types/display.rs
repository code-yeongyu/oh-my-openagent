use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::DesktopWindow;
use crate::error::{CoreResult, DesktopError};

/// Monitor geometry in both global logical desktop coordinates and composite
/// screenshot pixels.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DesktopDisplay {
    pub id: String,
    pub name: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale: f64,
    pub pixel_x: u32,
    pub pixel_y: u32,
    pub pixel_width: u32,
    pub pixel_height: u32,
    pub is_primary: bool,
}

/// Parsed display selector, resolved against the current focus at capture time.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DisplaySelector {
    Active,
    All,
    Id(String),
}

impl DisplaySelector {
    pub fn parse(display: Option<String>) -> Self {
        match display.as_deref().map(str::trim) {
            None | Some("") => Self::Active,
            Some(value) if value.eq_ignore_ascii_case("active") => Self::Active,
            Some(value) if value.eq_ignore_ascii_case("all") => Self::All,
            Some(id) => Self::Id(id.to_owned()),
        }
    }

    /// Selects the unique largest focused-window intersection. Ties, missing
    /// focus and zero intersection use the primary (or first) display.
    /// Pixel offsets remain unchanged; capture lays out the selected set.
    pub fn select(
        &self,
        mut displays: Vec<DesktopDisplay>,
        focused: Option<&DesktopWindow>,
    ) -> CoreResult<Vec<DesktopDisplay>> {
        match self {
            Self::All => {}
            Self::Id(id) => displays.retain(|display| display.id == *id),
            Self::Active => {
                let primary = displays.iter().position(|display| display.is_primary)
                    .or_else(|| (!displays.is_empty()).then_some(0));
                let mut best = None;
                let mut best_area = 0;
                let mut tied = false;
                if let Some(window) = focused {
                    for (index, display) in displays.iter().enumerate() {
                        let left = i64::from(window.x).max(i64::from(display.x));
                        let top = i64::from(window.y).max(i64::from(display.y));
                        let right = (i64::from(window.x) + i64::from(window.width))
                            .min(i64::from(display.x) + i64::from(display.width));
                        let bottom = (i64::from(window.y) + i64::from(window.height))
                            .min(i64::from(display.y) + i64::from(display.height));
                        let area = (right - left).max(0) as u64 * (bottom - top).max(0) as u64;
                        if area > best_area {
                            best = Some(index);
                            best_area = area;
                            tied = false;
                        } else if area == best_area {
                            tied = true;
                        }
                    }
                }
                if let Some(index) = best.filter(|_| !tied).or(primary) {
                    let display = displays.swap_remove(index);
                    displays.clear();
                    displays.push(display);
                }
            }
        }
        if displays.is_empty() {
            return Err(match self {
                Self::Id(id) => DesktopError::invalid_target(format!("selected display id '{id}' is not active")),
                Self::Active | Self::All => DesktopError::capture_failed("no active displays were found"),
            });
        }
        Ok(displays)
    }
}

/// Runtime truth about what this host's backend can do right now.
///
/// Schema-backed field set; additions update Rust, generated schema and TS together.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DesktopCapabilities {
    pub backend: String,
    pub display_server: Option<String>,
    pub capture: bool,
    pub input: bool,
    pub ax: bool,
    pub background_window_input: bool,
    /// Whether the display-only virtual cursor is live now.
    pub cursor_overlay: bool,
    pub delivery_modes: Vec<String>,
    pub capture_permission: String,
    pub input_permission: String,
    pub ax_permission: String,
    pub display_count: u32,
    /// Whether foreground delivery restores the previous front window and cursor.
    pub focus_guard: bool,
    /// Live stop path: `global`, `host-relay`, or `none`.
    pub stop_path: String,
    /// Why the stop path is not `global`, when it is not.
    pub stop_reason: Option<String>,
    /// Windows mandatory integrity level of the engine process.
    pub integrity_level: Option<String>,
    pub screen_locked: bool,
    /// Captures run through the legacy `screencapture` path, not the
    /// ScreenCaptureKit worker (B9: macOS < 14, helper missing, or the
    /// helper failed to start).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub legacy_capture: bool,
}

impl DesktopCapabilities {
    pub fn unavailable() -> Self {
        Self {
            backend: "unavailable".to_string(),
            display_server: None,
            capture: false,
            input: false,
            ax: false,
            background_window_input: false,
            cursor_overlay: false,
            delivery_modes: Vec::new(),
            capture_permission: "unavailable".to_string(),
            input_permission: "unavailable".to_string(),
            ax_permission: "unavailable".to_string(),
            display_count: 0,
            focus_guard: false,
            stop_path: "none".to_string(),
            stop_reason: None,
            integrity_level: None,
            screen_locked: false,
            legacy_capture: false,
        }
    }
}
