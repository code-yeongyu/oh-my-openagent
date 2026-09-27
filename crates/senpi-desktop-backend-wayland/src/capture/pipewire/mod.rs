//! Wayland capture through the ScreenCast portal and PipeWire, with
//! libpipewire loaded at runtime (`libloading`): one frame per monitor
//! stream, composited at the portal's logical positions like the X11
//! desktop composite. Absent libpipewire, capture stays on the Screenshot
//! portal.

mod ffi;
mod lib;
#[cfg(test)]
mod live_tests;
mod pixels;
mod pod;
mod screencast;
mod stream;
#[cfg(test)]
mod tests;
mod window;

use image::{imageops, RgbaImage};
use senpi_desktop_core::types::DesktopDisplay;
use tokio::runtime::Runtime;

use screencast::Cast;
pub use window::crop_window;

pub const DISPLAY_PREFIX: &str = "wayland-screencast-";

#[derive(Debug)]
pub enum CastError {
    /// libpipewire is not installed: use the Screenshot portal instead.
    Unavailable(String),
    Refused(String),
    Failed(String),
}

pub struct ScreenCast {
    cast: Option<Cast>,
}

impl ScreenCast {
    pub const fn new() -> Self {
        Self { cast: None }
    }

    pub fn capture(&mut self, runtime: &Runtime) -> Result<(RgbaImage, Vec<DesktopDisplay>), CastError> {
        let pipewire = lib::pipewire().map_err(|reason| CastError::Unavailable(reason.to_owned()))?;
        if self.cast.is_none() {
            let cast = screencast::start(runtime).map_err(|(refused, message)| {
                if refused {
                    CastError::Refused(message)
                } else {
                    CastError::Failed(message)
                }
            })?;
            self.cast = Some(cast);
        }
        match self.cast.as_ref().map(|cast| grab_all(pipewire, cast)) {
            Some(Ok(frames)) => Ok(composite(&frames)),
            Some(Err(message)) => {
                // A failed grab usually means the cast ended; the next capture starts a new one.
                self.cast = None;
                Err(CastError::Failed(message))
            }
            None => Err(CastError::Failed("ScreenCast session missing".to_owned())),
        }
    }
}

fn grab_all(
    pipewire: &'static lib::PipeWire,
    cast: &Cast,
) -> Result<Vec<(screencast::MonitorStream, RgbaImage)>, String> {
    cast.monitors
        .iter()
        .map(|monitor| {
            let fd = cast
                .remote()
                .map_err(|error| format!("PipeWire remote fd: {error}"))?;
            stream::grab_frame(pipewire, monitor.node, fd).map(|image| (*monitor, image))
        })
        .collect()
}

/// Monitors sit at their logical positions; pixels scale by frame / logical
/// size (a HiDPI monitor streams more pixels than its logical size).
fn composite(frames: &[(screencast::MonitorStream, RgbaImage)]) -> (RgbaImage, Vec<DesktopDisplay>) {
    let min_x = frames
        .iter()
        .map(|(monitor, _)| monitor.position.0)
        .min()
        .unwrap_or(0);
    let min_y = frames
        .iter()
        .map(|(monitor, _)| monitor.position.1)
        .min()
        .unwrap_or(0);
    let displays: Vec<DesktopDisplay> = frames
        .iter()
        .enumerate()
        .map(|(index, (monitor, image))| {
            let (logical_w, logical_h) = monitor
                .size
                .and_then(|(w, h)| Some((u32::try_from(w).ok()?, u32::try_from(h).ok()?)))
                .filter(|(w, h)| *w > 0 && *h > 0)
                .unwrap_or((image.width(), image.height()));
            let scale = f64::from(image.width()) / f64::from(logical_w);
            let x = monitor.position.0 - min_x;
            let y = monitor.position.1 - min_y;
            DesktopDisplay {
                id: format!("{DISPLAY_PREFIX}{index}"),
                name: format!("Wayland monitor {index}"),
                x,
                y,
                width: logical_w,
                height: logical_h,
                scale,
                pixel_x: scaled(x, scale),
                pixel_y: scaled(y, scale),
                pixel_width: image.width(),
                pixel_height: image.height(),
                is_primary: index == 0,
            }
        })
        .collect();
    let width = displays
        .iter()
        .map(|d| d.pixel_x.saturating_add(d.pixel_width))
        .max()
        .unwrap_or(1);
    let height = displays
        .iter()
        .map(|d| d.pixel_y.saturating_add(d.pixel_height))
        .max()
        .unwrap_or(1);
    let mut canvas = RgbaImage::new(width, height);
    for (display, (_, image)) in displays.iter().zip(frames) {
        imageops::replace(
            &mut canvas,
            image,
            i64::from(display.pixel_x),
            i64::from(display.pixel_y),
        );
    }
    (canvas, displays)
}

fn scaled(offset: i32, scale: f64) -> u32 {
    let pixels = (f64::from(offset.max(0)) * scale).round();
    if pixels >= f64::from(u32::MAX) {
        u32::MAX
    } else {
        // Non-negative and below u32::MAX by the guards above.
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        let whole = pixels as u32;
        whole
    }
}
