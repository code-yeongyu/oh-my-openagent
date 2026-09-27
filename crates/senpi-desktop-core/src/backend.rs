//! The shared `Backend`/`AxBackend` traits every platform backend implements.
//!
//! FROZEN after the core port: the focus-guard, cursor, release, and
//! lock-screen hooks have no-op defaults so a backend without the capability
//! compiles unchanged and reports `focus_guard: false`.

use image::RgbaImage;

use crate::ax::{AxHandle, AxProps};
use crate::error::{CoreResult, DesktopError};
use crate::frame::FrameGeometry;
use crate::keys::KeyName;
use crate::types::{
    CaptureCaps, DesktopCapabilities, DesktopDisplay, DesktopPoint, DesktopWindow, FrontWindow, Target,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum DeliveryMode {
    #[default]
    Background,
    Foreground,
}

impl DeliveryMode {
    pub fn parse(value: Option<&str>) -> Self {
        if value.is_some_and(|value| value.trim().eq_ignore_ascii_case("foreground")) {
            Self::Foreground
        } else {
            Self::Background
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum MouseButton {
    #[default]
    Left,
    Right,
    Middle,
}

impl MouseButton {
    pub fn parse(value: Option<&str>) -> CoreResult<Self> {
        match value.map(str::trim) {
            None => Ok(Self::Left),
            Some(value) if value.eq_ignore_ascii_case("left") => Ok(Self::Left),
            Some(value) if value.eq_ignore_ascii_case("right") => Ok(Self::Right),
            Some(value) if value.eq_ignore_ascii_case("middle") => Ok(Self::Middle),
            Some(value) => Err(DesktopError::input_failed(format!("unknown button '{value}'"))),
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Modifiers {
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
    pub meta: bool,
}

#[derive(Debug, Clone)]
pub enum PointerEvent {
    Click {
        x: f64,
        y: f64,
        button: MouseButton,
        count: u32,
        modifiers: Modifiers,
    },
    Move {
        x: f64,
        y: f64,
    },
    Drag {
        path: Vec<(f64, f64)>,
        button: MouseButton,
        modifiers: Modifiers,
    },
    Scroll {
        x: f64,
        y: f64,
        dx: f64,
        dy: f64,
    },
}

pub trait Backend: Send {
    fn capabilities(&mut self) -> DesktopCapabilities;
    fn displays(&mut self) -> CoreResult<Vec<DesktopDisplay>>;
    fn windows(&mut self) -> CoreResult<Vec<DesktopWindow>>;
    fn capture(&mut self, target: &Target, caps: &CaptureCaps) -> CoreResult<(RgbaImage, FrameGeometry)>;
    fn pointer(
        &mut self,
        target: &Target,
        ev: PointerEvent,
        frame: &FrameGeometry,
        mode: DeliveryMode,
    ) -> CoreResult<()>;
    fn type_text(&mut self, target: &Target, text: &str, mode: DeliveryMode) -> CoreResult<()>;
    fn key_chord(&mut self, target: &Target, keys: &[KeyName], mode: DeliveryMode) -> CoreResult<()>;
    fn raise_window(&mut self, id: &str) -> CoreResult<()>;
    fn ax(&mut self) -> Option<&mut dyn AxBackend>;

    /// Releases every button and key this backend may still hold down.
    fn release_all(&mut self) -> CoreResult<()> {
        Ok(())
    }

    /// Current global logical cursor position, when the platform exposes it.
    fn cursor_position(&mut self) -> CoreResult<Option<DesktopPoint>> {
        Ok(None)
    }

    /// Moves the cursor to a global logical point without clicking.
    fn warp_cursor(&mut self, _point: DesktopPoint) -> CoreResult<()> {
        Ok(())
    }

    /// The window that currently owns the foreground, for the focus guard.
    fn front_window(&mut self) -> CoreResult<Option<FrontWindow>> {
        Ok(None)
    }

    /// Brings a previously captured front window back to the foreground.
    fn restore_front_window(&mut self, _front: &FrontWindow) -> CoreResult<()> {
        Ok(())
    }

    /// Hands key focus back to `front` (macOS after `activate_without_raise`).
    fn restore_key_focus(&mut self, _front: &FrontWindow) -> CoreResult<()> {
        Ok(())
    }

    /// Whether the interactive session is behind the lock screen.
    fn screen_locked(&mut self) -> CoreResult<bool> {
        Ok(false)
    }
}

pub trait AxBackend {
    fn window_root(&mut self, win: &DesktopWindow) -> CoreResult<AxHandle>;
    fn props(&mut self, h: &AxHandle) -> CoreResult<AxProps>;
    fn children(&mut self, h: &AxHandle) -> CoreResult<Vec<AxHandle>>;
    fn parent(&mut self, h: &AxHandle) -> CoreResult<Option<AxHandle>>;
    fn perform(&mut self, h: &AxHandle, action: &str) -> CoreResult<()>;
    fn set_value(&mut self, h: &AxHandle, value: &str) -> CoreResult<()>;
    fn focus(&mut self, h: &AxHandle) -> CoreResult<()>;
    fn element_at(&mut self, x: f64, y: f64) -> CoreResult<Option<AxHandle>>;
    fn focused_element(&mut self) -> CoreResult<Option<AxHandle>>;
    fn attributes(&mut self, h: &AxHandle) -> CoreResult<Vec<(String, String)>>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delivery_only_escalates_explicit_foreground() {
        assert_eq!(DeliveryMode::parse(None), DeliveryMode::Background);
        assert_eq!(DeliveryMode::parse(Some("garbage")), DeliveryMode::Background);
        assert_eq!(
            DeliveryMode::parse(Some(" FoReGrOuNd ")),
            DeliveryMode::Foreground
        );
    }
}
