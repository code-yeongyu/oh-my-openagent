//! The shared `Backend`/`AxBackend` traits every platform backend implements.
//!
//! FROZEN after the core port: the focus-guard, cursor, release, and
//! lock-screen hooks have no-op defaults so a backend without the capability
//! compiles unchanged and reports `focus_guard: false`.

use image::RgbaImage;

use crate::ax::{AxHandle, AxProps};
use crate::error::{CoreResult, DesktopError, TccPermission};
use crate::frame::FrameGeometry;
use crate::keys::KeyName;
pub use crate::protocol_results::AxInputMethod;
use crate::types::{
    CaptureCaps, DesktopCapabilities, DesktopDisplay, DesktopPoint, DesktopWindow, FrontWindow, Target,
};
use crate::user_input::{UserInputFeed, UserPresses};

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

/// Where an application has keyboard focus, for the refusal of keys an
/// element never took: its focused window as [`Backend::windows`] lists it,
/// and the focused element.
#[derive(Clone, Default)]
pub struct KeyboardFocus {
    pub window: Option<String>,
    pub element: Option<AxHandle>,
}

/// How text or keys addressed to an element ended ([`Backend::ax_type_text`]).
pub enum ElementDelivery {
    Delivered(AxInputMethod),
    /// The element did not take keyboard focus when asked to, so no key was
    /// sent; the focus is where the value says.
    Unfocused(KeyboardFocus),
}

pub trait Backend: Send {
    /// Independent release ownership, usable without borrowing a busy backend.
    /// Owners register this before admitting input into bounded fatal-stop mode.
    fn emergency_release(&self) -> Option<std::sync::Arc<dyn EmergencyRelease>> {
        None
    }

    fn permission_denied(&mut self, _permission: TccPermission) -> DesktopError {
        DesktopError::permission_denied("input permission is not granted")
    }

    fn capabilities(&mut self) -> DesktopCapabilities;

    /// Updates the display-only virtual cursor without changing admission.
    fn set_show_cursor(&mut self, _enabled: bool) {}

    fn displays(&mut self) -> CoreResult<Vec<DesktopDisplay>>;
    fn windows(&mut self) -> CoreResult<Vec<DesktopWindow>>;
    /// Captures `target`. `exclude_window_titles` names windows a display
    /// capture must leave out; backends without exclusion support ignore it.
    fn capture(
        &mut self,
        target: &Target,
        caps: &CaptureCaps,
        exclude_window_titles: &[String],
    ) -> CoreResult<(RgbaImage, FrameGeometry)>;
    fn pointer(
        &mut self,
        target: &Target,
        ev: PointerEvent,
        frame: &FrameGeometry,
        mode: DeliveryMode,
    ) -> CoreResult<()>;
    fn type_text(&mut self, target: &Target, text: &str, mode: DeliveryMode) -> CoreResult<()>;
    /// The system clipboard's text. Backends without clipboard access keep
    /// this default and refuse instead of pretending.
    fn clipboard_read(&mut self) -> CoreResult<String> {
        Err(DesktopError::internal("this desktop backend has no clipboard access"))
    }

    /// Replaces the system clipboard's text.
    fn clipboard_write(&mut self, _text: &str) -> CoreResult<()> {
        Err(DesktopError::internal("this desktop backend has no clipboard access"))
    }
    /// Backends with incremental text delivery check between Unicode scalars
    /// and report each fully delivered scalar. The default preserves the
    /// existing one-call behavior for backends without incremental input.
    fn type_text_interruptible(
        &mut self,
        target: &Target,
        text: &str,
        mode: DeliveryMode,
        check_stop: &dyn Fn() -> CoreResult<()>,
        delivered: &mut dyn FnMut(),
    ) -> CoreResult<()> {
        check_stop()?;
        self.type_text(target, text, mode)?;
        for _ in text.chars() {
            delivered();
        }
        Ok(())
    }
    /// Types `text` into the element `h` names (`ax.typeText`): by AX
    /// insertion into a native text field, else as keys once the element
    /// holds its application's keyboard focus, never unconfirmed.
    /// `check_stop` runs before every key press and `delivered` reports each
    /// fully delivered Unicode scalar. Backends without element input keep
    /// this default and refuse.
    fn ax_type_text(
        &mut self,
        _h: &AxHandle,
        _text: &str,
        _mode: DeliveryMode,
        _check_stop: &dyn Fn() -> CoreResult<()>,
        _delivered: &mut dyn FnMut(),
    ) -> CoreResult<ElementDelivery> {
        Err(DesktopError::ax_unsupported())
    }
    fn key_chord(&mut self, target: &Target, keys: &[KeyName], mode: DeliveryMode) -> CoreResult<()>;
    /// [`Self::key_chord`] with `check_stop` before every key press, so a stop
    /// or a cancellation lands between presses. The default checks once,
    /// before the chord, for backends that press a chord in one call.
    fn key_chord_interruptible(
        &mut self,
        target: &Target,
        keys: &[KeyName],
        mode: DeliveryMode,
        check_stop: &dyn Fn() -> CoreResult<()>,
    ) -> CoreResult<()> {
        check_stop()?;
        self.key_chord(target, keys, mode)
    }
    /// Native press/release around a session-owned interruptible wait.
    /// Backends without bounded input refuse rather than synthesizing clicks.
    fn hold_keys(
        &mut self,
        _target: &Target,
        _keys: &[KeyName],
        _mode: DeliveryMode,
        _control: &crate::holds::HoldControl<'_>,
    ) -> CoreResult<()> {
        Err(DesktopError::input_failed("bounded key holds are unavailable on this backend"))
    }

    fn hold_mouse(
        &mut self,
        _target: &Target,
        _hold: &crate::holds::MouseHold<'_>,
        _mode: DeliveryMode,
        _control: &crate::holds::HoldControl<'_>,
    ) -> CoreResult<()> {
        Err(DesktopError::input_failed("bounded mouse holds are unavailable on this backend"))
    }
    fn raise_window(&mut self, id: &str) -> CoreResult<()>;

    /// The immediate children of `window`'s menu at `path` (empty = the menu
    /// bar). Backends without menus yet refuse with `AxUnsupported`.
    fn menu_items(&mut self, _window: &DesktopWindow, _path: &[String]) -> CoreResult<Vec<crate::menus::MenuItem>> {
        Err(DesktopError::ax_unsupported())
    }

    /// Invokes the leaf command `path` names in `window`'s menu. Backends
    /// call `check_stop` at every menu level they open and immediately before
    /// the native press, so a stop chord or cancel landing mid-walk dispatches
    /// nothing. `delivery` is the session-admitted mode: background keys the
    /// window without raising it; foreground raises and keys it (the session
    /// admits foreground only under the control grant). Backends without menus
    /// yet refuse with `AxUnsupported`.
    fn menu_select(
        &mut self,
        _window: &DesktopWindow,
        _path: &[String],
        _delivery: DeliveryMode,
        _check_stop: &dyn Fn() -> CoreResult<()>,
    ) -> CoreResult<()> {
        Err(DesktopError::ax_unsupported())
    }

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

    /// Starts watching the user's own key presses and clicks; idempotent.
    /// Backends without a watch keep this no-op and report no
    /// `interventionWatch`.
    fn watch_user_input(&mut self) {}

    /// The user's presses the watch recorded since the last call.
    fn take_user_presses(&mut self) -> UserPresses {
        UserPresses::default()
    }

    /// The watch's shared feed, once `watch_user_input` ran; `None` while
    /// nothing is watched. The session reads it between and inside requests.
    fn user_input_feed(&mut self) -> Option<std::sync::Arc<dyn UserInputFeed>> {
        None
    }
}

/// Replays only tracked downs. Must not wait for the backend's input scope.
pub trait EmergencyRelease: Send + Sync {
    fn release_all(&self) -> CoreResult<()>;
}

/// The native window that owns an accessibility element.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AxOwner {
    /// The owner's id, in the form [`Backend::windows`] lists it.
    Window(String),
    /// The backend cannot name the owner; callers must not guess it.
    Unknown,
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

    /// The window that owns `h`, read live from the platform and named as
    /// `windows` (the live [`Backend::windows`]) lists it. Backends that
    /// cannot name it keep this default.
    fn owner(&mut self, _h: &AxHandle, _windows: &[DesktopWindow]) -> CoreResult<AxOwner> {
        Ok(AxOwner::Unknown)
    }
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
