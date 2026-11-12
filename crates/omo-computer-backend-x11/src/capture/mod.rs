//! X11 capture: display frames composited from root `GetImage` per RandR monitor, window
//! frames from the window's own Composite pixmap (occluders excluded), and the XFixes
//! cursor composited in device pixels. A root crop is the annotated last tier only.

mod connection;
mod ewmh;
mod pixels;
pub mod server;
mod window;
mod windows;

#[cfg(test)]
pub(crate) mod fake;
#[cfg(test)]
mod tests;

use image::{imageops, RgbaImage};
use omo_computer_core::backend::{CaptureOptions, Refusal, Target};
use omo_computer_core::capabilities::CaptureRoute;
use omo_computer_core::error::EngineCode;
use omo_computer_core::frame::{composite, DisplaySelector};
use omo_computer_core::listing::Rect;
use omo_computer_core::observation::CursorMode;
use omo_computer_core::results::DisplayInfo;

pub use self::connection::X11Connection;
pub use self::pixels::png;
pub use self::windows::{list_windows, process_facts, ProcessFacts};
use self::pixels::{blend_cursor, crosshair, decode};
use self::server::{XError, XServer};
use crate::displays::{display_id, display_infos};
use crate::monitors::{self, MonitorReading};

/// One captured frame with the annotations the report carries.
#[derive(Debug, Clone, PartialEq)]
pub struct CapturedFrame {
    pub image: RgbaImage,
    pub route: CaptureRoute,
    /// Windows covering the target may show in the pixels (the root-crop tier).
    pub occluders_visible: bool,
    pub cursor: CursorMode,
    /// Displays left out of a composite.
    pub dropped: Vec<String>,
}

/// The capture half of the X11 backend over one X server.
pub struct X11Capture<S = X11Connection> {
    server: S,
    gdk_scale: Option<String>,
}

pub(crate) fn failed(error: &XError) -> Refusal {
    eprintln!("omo-computer-backend-x11: {error}");
    Refusal::bare(EngineCode::CaptureFailed)
}

fn round_px(value: f64) -> i64 {
    #[allow(clippy::cast_possible_truncation)]
    let rounded = value.round() as i64;
    rounded
}

fn round_size(value: f64) -> u32 {
    u32::try_from(round_px(value)).unwrap_or(0)
}

impl<S: XServer> X11Capture<S> {
    #[must_use]
    pub const fn new(server: S, gdk_scale: Option<String>) -> Self {
        Self { server, gdk_scale }
    }

    pub(crate) const fn server(&self) -> &S {
        &self.server
    }

    pub(crate) fn readings(&self) -> Result<Vec<MonitorReading>, Refusal> {
        monitors::read(&self.server, self.gdk_scale.as_deref()).map_err(|error| failed(&error))
    }

    /// # Errors
    /// `CaptureFailed` when RandR cannot be read.
    pub fn displays(&self) -> Result<Vec<DisplayInfo>, Refusal> {
        Ok(display_infos(&self.readings()?))
    }

    /// # Errors
    /// The refusal of the target's tier: `WindowNotFound`, `InvalidTarget`,
    /// `CaptureUnavailable{minimized|unmapped}` or `CaptureFailed`.
    pub fn capture_frame(
        &self,
        target: &Target,
        options: &CaptureOptions,
    ) -> Result<CapturedFrame, Refusal> {
        let (mut frame, origin, scale) = match target {
            Target::Desktop => self.capture_displays(&DisplaySelector::All, options)?,
            Target::Display(id) => self.capture_displays(&DisplaySelector::Id(id.clone()), options)?,
            Target::Window(id) => self.capture_window(id, options)?,
        };
        if let Some(at) = options.crosshair {
            crosshair(&mut frame.image, at.x, at.y);
        }
        if let Some(region) = options.region {
            frame.image = crop(&frame.image, &region, &origin, scale)?;
        }
        Ok(frame)
    }

    fn capture_displays(
        &self,
        selector: &DisplaySelector,
        options: &CaptureOptions,
    ) -> Result<(CapturedFrame, Rect, f64), Refusal> {
        let readings = self.readings()?;
        let displays = display_infos(&readings);
        let plan = composite(&displays, selector, None)
            .ok_or(Refusal::bare(EngineCode::InvalidTarget))?;
        let mut canvas = RgbaImage::new(plan.width, plan.height);
        let mut placed = Vec::with_capacity(plan.shown.len());
        for (shown, region) in plan.shown.iter().zip(&plan.regions) {
            let reading = readings
                .iter()
                .find(|reading| display_id(&reading.monitor) == shown.id)
                .ok_or(Refusal::bare(EngineCode::InvalidTarget))?;
            let raw = self
                .server
                .root_image(reading.monitor.rect)
                .map_err(|error| failed(&error))?;
            let mut image = decode(&raw).map_err(|error| failed(&error))?;
            let (width, height) = (round_size(region.pixel.width), round_size(region.pixel.height));
            if (image.width(), image.height()) != (width, height) {
                image = imageops::resize(&image, width, height, imageops::FilterType::Triangle);
            }
            imageops::replace(&mut canvas, &image, round_px(region.pixel.x), round_px(region.pixel.y));
            placed.push((reading.monitor.rect, *region));
        }
        let mut cursor = CursorMode::None;
        if options.cursor {
            if let Some(image) = self.server.cursor().map_err(|error| failed(&error))? {
                if let Some((rect, region)) = placed.iter().find(|(rect, _)| rect.contains(image.x, image.y)) {
                    let ratio = region.pixel.width / f64::from(rect.width.max(1));
                    let x = round_px(region.pixel.x + f64::from(image.x - rect.x) * ratio);
                    let y = round_px(region.pixel.y + f64::from(image.y - rect.y) * ratio);
                    blend_cursor(&mut canvas, &image, x - i64::from(image.xhot), y - i64::from(image.yhot));
                    cursor = CursorMode::Engine;
                }
            }
        }
        let origin = plan
            .regions
            .iter()
            .map(|region| region.logical)
            .reduce(|a, b| Rect {
                x: a.x.min(b.x),
                y: a.y.min(b.y),
                width: 0.0,
                height: 0.0,
            })
            .unwrap_or(Rect {
                x: 0.0,
                y: 0.0,
                width: 0.0,
                height: 0.0,
            });
        let frame = CapturedFrame {
            image: canvas,
            route: CaptureRoute::Composite,
            occluders_visible: false,
            cursor,
            dropped: plan.dropped,
        };
        Ok((frame, origin, plan.scale))
    }
}

/// Crops the frame to `region` (desktop logical coordinates) given the frame's logical
/// origin and scale.
fn crop(image: &RgbaImage, region: &Rect, origin: &Rect, scale: f64) -> Result<RgbaImage, Refusal> {
    let x = round_px((region.x - origin.x) * scale);
    let y = round_px((region.y - origin.y) * scale);
    let (width, height) = (round_size(region.width * scale), round_size(region.height * scale));
    let (Ok(x), Ok(y)) = (u32::try_from(x), u32::try_from(y)) else {
        return Err(Refusal::bare(EngineCode::CaptureFailed));
    };
    let fits = width > 0
        && height > 0
        && u64::from(x) + u64::from(width) <= u64::from(image.width())
        && u64::from(y) + u64::from(height) <= u64::from(image.height());
    if !fits {
        return Err(Refusal::bare(EngineCode::CaptureFailed));
    }
    Ok(imageops::crop_imm(image, x, y, width, height).to_image())
}
