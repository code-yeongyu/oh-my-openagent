//! X11 capture: RandR display enumeration, EWMH window enumeration, and
//! `GetImage(ZPixmap)` of the root window, over pure-Rust x11rb.

mod connection;
mod image;
mod monitors;
mod windows;

#[cfg(test)]
mod capture_tests;
#[cfg(test)]
pub(crate) mod fake;
#[cfg(test)]
mod live_tests;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod windows_tests;

use ::image::{imageops, RgbaImage};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::types::{DesktopDisplay, DesktopWindow, DisplaySelector, Target};
use x11rb::protocol::xproto::Window;

pub use self::connection::X11Connection;
pub use self::connection::XServer;
use self::image::{clip_to_root, to_rgba, RootRect};

pub struct X11Capture<S = X11Connection> {
    server: S,
    selector: DisplaySelector,
}

impl X11Capture<X11Connection> {
    /// Connects through `DISPLAY` and proves the root is readable with a
    /// 1x1 `GetImage`, so an unreadable root fails at session open.
    ///
    /// # Errors
    /// `CaptureFailed` naming why the X server cannot be captured.
    pub fn new(selector: DisplaySelector) -> CoreResult<Self> {
        Self::with_server(X11Connection::connect()?, selector)
    }
}

impl<S: XServer> X11Capture<S> {
    pub(crate) fn with_server(server: S, selector: DisplaySelector) -> CoreResult<Self> {
        let capture = Self { server, selector };
        capture.capture_rect(RootRect {
            x: 0,
            y: 0,
            width: 1,
            height: 1,
        })?;
        Ok(capture)
    }

    /// The root window every capture reads from.
    pub fn root(&self) -> Window {
        self.server.screen().root
    }

    /// # Errors
    /// `CaptureFailed` when RandR fails or the selected display is absent.
    pub fn displays(&self) -> CoreResult<Vec<DesktopDisplay>> {
        monitors::displays(&self.server, &self.selector)
    }

    /// # Errors
    /// `CaptureFailed` when an EWMH atom cannot be interned.
    pub fn windows(&self) -> CoreResult<Vec<DesktopWindow>> {
        windows::windows(&self.server)
    }

    /// # Errors
    /// `WindowNotFound` for an unknown window id; `CaptureFailed` when the
    /// target has no visible root area or `GetImage` fails.
    pub fn capture(&self, target: &Target) -> CoreResult<(RgbaImage, FrameGeometry)> {
        match target {
            Target::Desktop => self.capture_desktop(),
            Target::Window(id) => self.capture_window(id),
        }
    }

    /// Every selected display composited at its `pixel_x/pixel_y`.
    fn capture_desktop(&self) -> CoreResult<(RgbaImage, FrameGeometry)> {
        let displays = self.displays()?;
        let frame = FrameGeometry::for_displays(&displays);
        let width = displays
            .iter()
            .map(|display| display.pixel_x.saturating_add(display.pixel_width))
            .max()
            .unwrap_or(1);
        let height = displays
            .iter()
            .map(|display| display.pixel_y.saturating_add(display.pixel_height))
            .max()
            .unwrap_or(1);
        let mut composite = RgbaImage::new(width, height);
        for display in &displays {
            let image = self.capture_rect(RootRect {
                x: display.x,
                y: display.y,
                width: display.width,
                height: display.height,
            })?;
            imageops::replace(
                &mut composite,
                &image,
                i64::from(display.pixel_x),
                i64::from(display.pixel_y),
            );
        }
        Ok((composite, frame))
    }

    /// The window's on-root area; the frame describes the clipped bounds.
    fn capture_window(&self, id: &str) -> CoreResult<(RgbaImage, FrameGeometry)> {
        let window = self
            .windows()?
            .into_iter()
            .find(|window| window.id == id)
            .ok_or_else(|| DesktopError::window_not_found(format!("window {id} was not found")))?;
        let screen = self.server.screen();
        let rect = RootRect {
            x: window.x,
            y: window.y,
            width: window.width,
            height: window.height,
        };
        let clipped = clip_to_root(rect, screen.width, screen.height)
            .ok_or_else(|| DesktopError::capture_failed(format!("window {id} has no visible root area")))?;
        let image = self.capture_rect(clipped)?;
        let frame_window = DesktopWindow {
            x: clipped.x,
            y: clipped.y,
            width: clipped.width,
            height: clipped.height,
            ..window
        };
        let frame = FrameGeometry::for_window(&frame_window, image.width(), image.height());
        Ok((image, frame))
    }

    fn capture_rect(&self, rect: RootRect) -> CoreResult<RgbaImage> {
        to_rgba(&self.server.root_image(rect)?, self.server.screen().masks)
    }
}
