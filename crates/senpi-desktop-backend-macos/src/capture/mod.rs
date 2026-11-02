//! Screen capture: TCC preflight, display/window enumeration, and the base
//! `screencapture`/CoreGraphics capture mechanisms. The B9 routing between
//! the ScreenCaptureKit worker and the legacy path lives in `route.rs`.
//! Known cursor-helper windows are excluded from every frame by window ID.
//! Never prompts for permission.

mod displays;
pub(crate) mod fallback;
mod filtered;
mod minimized;
mod route;
mod sck;
pub(crate) mod screencapture;
mod windows;

use image::RgbaImage;
use senpi_desktop_core::error::{CoreResult, DesktopError, TccPermission};
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::types::{DesktopDisplay, DesktopWindow, DisplaySelector, Target};

pub(crate) use self::screencapture::Screencapture;
use self::screencapture::{display_args, window_args, ShotError};

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    /// Non-prompting TCC preflight for Screen Recording; takes no arguments.
    safe fn CGPreflightScreenCaptureAccess() -> bool;
}

/// Whether captures can hide cursor-helper windows per frame (macOS 14+).
pub(crate) fn filtered_capture_supported() -> bool {
    filtered::supported()
}

/// Whether this process may capture the screen, without prompting.
pub(crate) fn capture_permission() -> bool {
    CGPreflightScreenCaptureAccess()
}

/// Screen Recording guidance for the launcher whose TCC grant is missing.
pub(crate) fn permission_denied() -> DesktopError {
    crate::backend::permissions::permission_denied(TccPermission::ScreenRecording)
}

#[derive(Debug, Clone)]
pub(crate) struct MacCapture {
    selector: DisplaySelector,
    shooter: Screencapture,
    overlay: crate::overlay::Overlay,
}

impl MacCapture {
    pub(crate) fn new(selector: DisplaySelector, shooter: Screencapture) -> Self {
        Self { selector, shooter, overlay: crate::overlay::Overlay::default() }
    }

    pub(crate) fn with_overlay(mut self, overlay: crate::overlay::Overlay) -> Self {
        self.overlay = overlay;
        self
    }

    pub(crate) fn permission_granted(&self) -> bool {
        self.shooter.permission_granted()
    }

    /// The displays the session's selector names (all, for active).
    pub(crate) fn displays(&self) -> CoreResult<Vec<DesktopDisplay>> {
        self.require_permission()?;
        displays::enumerate(&self.selector)
    }

    /// Every monitor, whatever the session's selector, so a per-call display
    /// target can name one the session does not capture by default.
    pub(crate) fn all_displays(&self) -> CoreResult<Vec<DesktopDisplay>> {
        self.require_permission()?;
        displays::enumerate(&DisplaySelector::All)
    }

    pub(crate) fn windows(&self) -> CoreResult<Vec<DesktopWindow>> {
        self.require_permission()?;
        windows::enumerate()
    }

    pub(crate) fn capture(&self, target: &Target) -> CoreResult<(RgbaImage, FrameGeometry)> {
        self.capture_with_exclusions(target, &[])
    }

    /// Runs `capture` under the cursor-overlay exclusion guard: the lock covers
    /// the whole dispatch (SCK worker, multi-display batches, CoreGraphics), and
    /// a helper that appeared during the shot fails the frame.
    fn with_overlay_exclusion<T>(&self, capture: impl FnOnce(&[u32]) -> CoreResult<T>) -> CoreResult<T> {
        let lock_path = capture_lock_path().map_err(|error| {
            DesktopError::capture_failed(format!("cannot locate account cursor-exclusion cache: {error}"))
        })?;
        self.overlay.capture(&lock_path, crate::focus::window_info, std::thread::sleep, |excluded| {
            let result = capture(excluded)?;
            // A launcher with another cache domain must not introduce an unfiltered helper.
            let after = crate::focus::window_info()?;
            if after.iter().any(|window| window.cursor_overlay && !excluded.contains(&window.window_number)) {
                return Err(DesktopError::capture_failed("a new cursor helper was not included in the exclusion filter"));
            }
            Ok(result)
        })
    }

    fn displays_for(&self, selector: &DisplaySelector) -> CoreResult<Vec<DesktopDisplay>> {
        let focused = if *selector == DisplaySelector::Active {
            match crate::focus::front_window_id() {
                Ok(Some(id)) => match windows::find(&id.to_string()) {
                    Ok(window) => Some(window),
                    Err(error) => {
                        eprintln!("active capture cannot locate the front window; using primary: {error}");
                        None
                    }
                },
                Ok(None) => None,
                Err(error) => {
                    eprintln!("active capture cannot query focus; using primary: {error}");
                    None
                }
            }
        } else {
            None
        };
        selector.select(displays::enumerate(selector)?, focused.as_ref())
    }

    fn require_permission(&self) -> CoreResult<()> {
        if self.permission_granted() {
            Ok(())
        } else {
            Err(permission_denied())
        }
    }

    /// One `screencapture -x -R<rect>` per display, composited. When the tool
    /// is absent or fails with permission granted, the primary display is
    /// captured through CoreGraphics instead.
    fn capture_desktop(&self, selector: &DisplaySelector, excluded: &[u32]) -> CoreResult<(RgbaImage, FrameGeometry)> {
        self.require_permission()?;
        let displays = self.displays_for(selector)?;
        let mut regions = Vec::with_capacity(displays.len());
        for display in &displays {
            let image = if !excluded.is_empty() {
                let id = display.id.parse::<u32>()
                    .map_err(|_| DesktopError::capture_failed("filtered display has no native ID"))?;
                filtered::capture(Some(id), None, display.pixel_width, display.pixel_height, excluded)?
            } else {
                match self.shooter.run(&display_args(display)) {
                    Ok(image) => image,
                    Err(ShotError::Unavailable(reason)) => {
                        return fallback::capture_primary(&displays, &reason);
                    }
                    Err(ShotError::Fatal(error)) => return Err(error),
                }
            };
            if image.width() == 0 || image.height() == 0 {
                return Err(DesktopError::capture_failed(format!(
                    "capture of display '{}' returned an empty image",
                    display.id
                )));
            }
            regions.push((display.clone(), image));
        }
        displays::composite(regions)
    }

    /// `screencapture -x -o -l <wid>`; window capture has no fallback.
    fn capture_window(&self, id: &str, excluded: &[u32]) -> CoreResult<(RgbaImage, FrameGeometry)> {
        let window_id = parse_window_id(id)?;
        self.require_permission()?;
        if excluded.contains(&window_id) {
            return Err(DesktopError::capture_failed("cursor-helper windows are not capture targets"));
        }
        let window = windows::find(id)?;
        let image = if !excluded.is_empty() {
            filtered::capture(None, Some(window_id), window.width, window.height, excluded)?
        } else {
            self.shooter.run(&window_args(window_id)).map_err(DesktopError::from)?
        };
        if image.width() == 0 || image.height() == 0 {
            return Err(DesktopError::capture_failed(format!(
                "capture of window '{id}' returned an empty image"
            )));
        }
        let geometry = FrameGeometry::for_window(&window, image.width(), image.height());
        Ok((image, geometry))
    }
}

/// The account's cursor-exclusion lock; tests point it at a private file.
fn capture_lock_path() -> std::io::Result<std::path::PathBuf> {
    #[cfg(test)]
    if let Some(path) = TEST_LOCK_PATH.with_borrow(Clone::clone) {
        return Ok(path);
    }
    crate::overlay::lock_path()
}

#[cfg(test)]
thread_local! {
    pub(crate) static TEST_LOCK_PATH: std::cell::RefCell<Option<std::path::PathBuf>> =
        const { std::cell::RefCell::new(None) };
}

fn parse_window_id(id: &str) -> CoreResult<u32> {
    id.parse::<u32>()
        .map_err(|_| DesktopError::invalid_target(format!("invalid macOS window id '{id}'")))
}

/// Hides helper windows from the window list. `helper_ids` are the windows WindowServer
/// reports as helpers (title and level); without that list every title match is hidden.
fn exclude_overlay_windows(windows: &mut Vec<DesktopWindow>, helper_ids: Option<&[u32]>) {
    windows.retain(|window| {
        if window.title != crate::overlay::WINDOW_TITLE {
            return true;
        }
        helper_ids.is_some_and(|ids| window.id.parse::<u32>().map_or(true, |id| !ids.contains(&id)))
    });
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod live_tests;
