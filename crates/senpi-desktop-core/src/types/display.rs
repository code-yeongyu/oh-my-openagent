use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

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

/// Parsed `display` session option: every active display or one by id.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DisplaySelector {
    All,
    Id(String),
}

impl DisplaySelector {
    pub fn parse(display: Option<String>) -> Self {
        match display {
            Some(id) if !id.trim().is_empty() && !id.eq_ignore_ascii_case("all") => Self::Id(id),
            _ => Self::All,
        }
    }
}

/// Runtime truth about what this host's backend can do right now.
///
/// FROZEN field set (IS-2): later todos fill values, never add fields.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DesktopCapabilities {
    pub backend: String,
    pub display_server: Option<String>,
    pub capture: bool,
    pub input: bool,
    pub ax: bool,
    pub background_window_input: bool,
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
        }
    }
}
