//! Wayland capture. Where libpipewire loads at runtime, the ScreenCast
//! portal streams each monitor and the desktop is their composite, one
//! display per monitor (`pipewire`). Otherwise the
//! `org.freedesktop.portal.Screenshot` portal hands back one image of the
//! whole desktop as the single logical display `wayland-portal-0` at scale 1.
//! The shipped engine never links libpipewire (D6). Neither path captures a
//! single window.
//!
//! Capabilities stay honest: `capture` is `true` only after a screenshot
//! actually came back. Some compositors (GNOME, KDE) show a consent dialog
//! the first time; wlroots' portal does not.

#[cfg(test)]
mod live_tests;
pub mod pipewire;
pub mod screenshot_portal;

use std::slice;

use image::RgbaImage;
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::types::{DesktopDisplay, DesktopWindow, DisplaySelector, Target};

use self::pipewire::{CastError, ScreenCast};
use self::screenshot_portal::ShotError;
use crate::portal::portal_runtime;

/// The one display a portal screenshot describes.
pub const PORTAL_DISPLAY_ID: &str = "wayland-portal-0";

/// What the Screenshot portal has proven so far.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Probe {
    /// Not asked yet.
    Unknown,
    /// The portal is served, but no screenshot came back yet.
    Offered,
    /// No session bus, no `xdg-desktop-portal`, or no Screenshot backend.
    Absent,
    /// The user or compositor refused the last screenshot.
    Refused,
    /// A screenshot came back.
    Granted,
}

impl Probe {
    const fn permission(self) -> &'static str {
        match self {
            Self::Unknown | Self::Offered => "prompt-or-granted",
            Self::Absent => "unavailable",
            Self::Refused => "denied",
            Self::Granted => "granted",
        }
    }
}

pub struct PortalCapture {
    selector: DisplaySelector,
    pub(crate) probe: Probe,
    displays: Vec<DesktopDisplay>,
    screencast: ScreenCast,
    screencast_fallback: Option<String>,
}

impl PortalCapture {
    pub const fn new(selector: DisplaySelector) -> Self {
        Self {
            selector,
            probe: Probe::Unknown,
            displays: Vec::new(),
            screencast: ScreenCast::new(),
            screencast_fallback: None,
        }
    }

    /// `capturePermission`; reads the portal's `version` once, never takes a
    /// screenshot.
    pub fn permission(&mut self) -> &'static str {
        if self.probe == Probe::Unknown {
            self.probe = match portal_runtime().map(screenshot_portal::presence) {
                Ok(Ok(())) => Probe::Offered,
                Ok(Err(_)) | Err(_) => Probe::Absent,
            };
        }
        self.probe.permission()
    }

    pub fn is_proven(&self) -> bool {
        self.probe == Probe::Granted
    }

    /// The display of the last screenshot; empty before the first one.
    pub fn displays(&self) -> Vec<DesktopDisplay> {
        self.displays.clone()
    }

    /// Takes a portal screenshot of the whole desktop.
    ///
    /// # Errors
    /// `CaptureFailed` for a window target or when the portal is absent or
    /// fails; `PermissionDenied` when the screenshot is refused;
    /// `InvalidTarget` when the session selected another display.
    pub fn capture(
        &mut self,
        target: &Target,
        windows: impl FnOnce() -> CoreResult<Vec<DesktopWindow>>,
    ) -> CoreResult<(RgbaImage, FrameGeometry)> {
        self.selected_display_allowed()?;
        let runtime = portal_runtime()?;
        match self.screencast.capture(runtime) {
            Ok((image, displays)) => {
                self.probe = Probe::Granted;
                self.displays = displays;
                return match target {
                    Target::Desktop => Ok((image, FrameGeometry::for_displays(&self.displays))),
                    Target::Window(id) => pipewire::crop_window(&image, &self.displays, windows()?, id),
                };
            }
            Err(CastError::Refused(message)) => {
                self.probe = Probe::Refused;
                return Err(DesktopError::permission_denied(message));
            }
            Err(CastError::Unavailable(reason) | CastError::Failed(reason)) => {
                self.screencast_fallback = Some(reason);
            }
        }
        if let Target::Window(id) = target {
            let cast = self.screencast_fallback.as_deref().unwrap_or("not tried");
            return Err(DesktopError::capture_failed(format!(
                "window {id}: window capture needs the ScreenCast portal (ScreenCast: {cast}); \
                 the Screenshot portal captures the whole desktop only, so capture the desktop instead"
            )));
        }
        if self.probe != Probe::Granted {
            if let Err(reason) = screenshot_portal::presence(runtime) {
                self.probe = Probe::Absent;
                let cast = self.screencast_fallback.as_deref().unwrap_or("not tried");
                return Err(DesktopError::capture_failed(format!(
                    "{}: {reason} (ScreenCast: {cast})",
                    screenshot_portal::UNAVAILABLE
                )));
            }
            self.probe = Probe::Offered;
        }
        let image = screenshot_portal::take(runtime).map_err(|error| match error {
            ShotError::Refused(message) => {
                self.probe = Probe::Refused;
                DesktopError::permission_denied(message)
            }
            ShotError::Failed(message) => match &self.screencast_fallback {
                Some(cast) => DesktopError::capture_failed(format!("{message} (ScreenCast: {cast})")),
                None => DesktopError::capture_failed(message),
            },
        })?;
        self.probe = Probe::Granted;
        let display = portal_display(image.width(), image.height());
        let frame = FrameGeometry::for_displays(slice::from_ref(&display));
        self.displays = vec![display];
        Ok((image, frame))
    }

    fn selected_display_allowed(&self) -> CoreResult<()> {
        match &self.selector {
            DisplaySelector::All => Ok(()),
            DisplaySelector::Id(id)
                if id == PORTAL_DISPLAY_ID || id.starts_with(pipewire::DISPLAY_PREFIX) =>
            {
                Ok(())
            }
            DisplaySelector::Id(id) => Err(DesktopError::invalid_target(format!(
                "Wayland portal display '{id}' is unavailable; use 'all' or '{PORTAL_DISPLAY_ID}'"
            ))),
        }
    }
}

/// The screenshot as one display at scale 1, logical size = pixel size.
fn portal_display(width: u32, height: u32) -> DesktopDisplay {
    DesktopDisplay {
        id: PORTAL_DISPLAY_ID.to_owned(),
        name: "Wayland portal screenshot".to_owned(),
        x: 0,
        y: 0,
        width,
        height,
        scale: 1.0,
        pixel_x: 0,
        pixel_y: 0,
        pixel_width: width,
        pixel_height: height,
        is_primary: true,
    }
}
