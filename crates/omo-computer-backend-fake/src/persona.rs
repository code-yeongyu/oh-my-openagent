//! The per-OS personas: one scenario runs as each, so one corpus case runs as "fake x3".

use omo_computer_core::capabilities::CaptureRoute;
use omo_computer_core::listing::WindowIdentity;
use serde::Deserialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Persona {
    Macos,
    X11,
    Wayland,
    Win32,
}

impl Persona {
    pub const ALL: [Self; 4] = [Self::Macos, Self::X11, Self::Wayland, Self::Win32];

    /// The persona of the host the tests run on, so each CI leg plays its own OS.
    #[must_use]
    pub const fn host() -> Self {
        if cfg!(target_os = "macos") {
            Self::Macos
        } else if cfg!(target_os = "windows") {
            Self::Win32
        } else {
            Self::X11
        }
    }

    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Macos => "macos",
            Self::X11 => "x11",
            Self::Wayland => "wayland",
            Self::Win32 => "win32",
        }
    }

    /// The window handle member this OS fills.
    #[must_use]
    pub fn window_identity(self, window_id: &str, pid: u32, process_start: u64) -> WindowIdentity {
        let handle = window_id.parse::<u64>().ok();
        WindowIdentity {
            window_number: handle.filter(|_| self == Self::Macos),
            hwnd: handle.filter(|_| self == Self::Win32),
            xid: handle
                .filter(|_| self == Self::X11)
                .and_then(|id| u32::try_from(id).ok()),
            pid,
            process_start,
        }
    }

    #[must_use]
    pub const fn capture_route(self) -> Option<CaptureRoute> {
        match self {
            Self::X11 => Some(CaptureRoute::Composite),
            Self::Wayland => Some(CaptureRoute::Screencast),
            Self::Macos | Self::Win32 => None,
        }
    }

    /// The name of the OS stop listener this persona stands in for.
    #[must_use]
    pub const fn stop_listener(self) -> &'static str {
        match self {
            Self::Macos => "event-tap",
            Self::X11 => "xi2-raw",
            Self::Wayland => "global-shortcuts",
            Self::Win32 => "ll-keyboard-hook",
        }
    }
}
