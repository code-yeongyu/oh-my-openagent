use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::DisplaySelector;

/// One capturable top-level window in global logical desktop coordinates.
/// `is_on_screen` distinguishes an on-Space window from a same-app window on
/// another Space: both resolve as capture targets, but only an on-screen one
/// is user-visible right now.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DesktopWindow {
    /// Backend-defined opaque window id, valid as a capture target while the
    /// window lives. Numeric on X11/Win32/macOS; a composite AT-SPI string on
    /// Wayland (e.g. `atspi::1.31:/org/a11y/atspi/accessible/1`). Never parse
    /// it.
    pub id: String,
    /// Window title; may be empty for untitled windows.
    pub title: String,
    /// Owning application name.
    pub app: String,
    /// Owning process id when the platform exposes it.
    pub pid: Option<u32>,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    /// Whether the window currently holds input focus.
    pub focused: bool,
    /// Whether the window is on the active Space. `None` on backends that
    /// cannot tell (X11/Win32/Wayland report every listed window on screen).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_on_screen: Option<bool>,
    /// Whether the owning process runs above the engine's integrity level
    /// (Windows); `None` where the platform has no such notion.
    pub elevated: Option<bool>,
}

/// The front application/window snapshot a foreground action restores.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FrontWindow {
    pub pid: u32,
    pub window_id: Option<String>,
    pub app: String,
    pub key_window_ax_title: Option<String>,
}

/// Parsed input/capture target: desktop, window id, or a display selector.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Target {
    Desktop,
    /// Canonical `display:<selector>` key, distinct from desktop/window frames.
    Display(String),
    Window(String),
}

impl Target {
    pub fn parse(value: &str) -> Self {
        if value.eq_ignore_ascii_case("desktop") {
            Self::Desktop
        } else if let Some(selector) = value.strip_prefix("display:") {
            let selector = match DisplaySelector::parse(Some(selector.to_owned())) {
                DisplaySelector::Active => "active".to_owned(),
                DisplaySelector::All => "all".to_owned(),
                DisplaySelector::Id(id) => id,
            };
            Self::Display(format!("display:{selector}"))
        } else {
            Self::Window(value.to_string())
        }
    }

    pub fn key(&self) -> &str {
        match self {
            Self::Desktop => "desktop",
            Self::Window(id) | Self::Display(id) => id,
        }
    }

    pub fn display_selector(&self) -> Option<DisplaySelector> {
        match self {
            Self::Display(key) => Some(DisplaySelector::parse(
                key.strip_prefix("display:").map(str::to_owned),
            )),
            Self::Desktop | Self::Window(_) => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct PointerOptions {
    pub button: Option<String>,
    pub count: Option<u32>,
    pub modifiers: Option<Vec<String>>,
    pub delivery_mode: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPoint {
    pub x: f64,
    pub y: f64,
}

#[cfg(test)]
mod tests {
    use super::DesktopWindow;

    #[test]
    fn desktop_window_retains_the_eq_trait_contract() {
        fn require_eq<T: Eq>() {}
        require_eq::<DesktopWindow>();
    }
}
