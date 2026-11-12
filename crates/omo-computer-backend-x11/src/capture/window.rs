//! Window frames: the window's own Composite pixmap after a Damage round trip, so a
//! covering window never shows. With no compositing manager the one target window is
//! redirected for the read. Only when Composite is absent or the redirect is refused does
//! the frame fall back to a root crop, annotated `occludersVisible:true`.

use image::{imageops, RgbaImage};
use omo_computer_core::backend::{CaptureOptions, Refusal};
use omo_computer_core::capabilities::CaptureRoute;
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::listing::Rect;
use omo_computer_core::observation::CursorMode;

use super::pixels::{blend_cursor, decode};
use super::server::{PixelRect, PixmapRead, WindowPlacement, XServer};
use super::{failed, CapturedFrame, X11Capture};

/// A window id as `windows()` lists it: decimal, or `0x` hex.
#[must_use]
pub fn parse_xid(id: &str) -> Option<u32> {
    match id.strip_prefix("0x").or_else(|| id.strip_prefix("0X")) {
        Some(hex) => u32::from_str_radix(hex, 16).ok(),
        None => id.parse().ok(),
    }
}

fn clip_to_screen(rect: PixelRect, width: u32, height: u32) -> Option<PixelRect> {
    let left = i64::from(rect.x).max(0);
    let top = i64::from(rect.y).max(0);
    let right = (i64::from(rect.x) + i64::from(rect.width)).min(i64::from(width));
    let bottom = (i64::from(rect.y) + i64::from(rect.height)).min(i64::from(height));
    if right <= left || bottom <= top {
        return None;
    }
    Some(PixelRect {
        x: i32::try_from(left).ok()?,
        y: i32::try_from(top).ok()?,
        width: u32::try_from(right - left).ok()?,
        height: u32::try_from(bottom - top).ok()?,
    })
}

impl<S: XServer> X11Capture<S> {
    pub(super) fn capture_window(
        &self,
        id: &str,
        options: &CaptureOptions,
    ) -> Result<(CapturedFrame, Rect, f64), Refusal> {
        let xid = parse_xid(id).ok_or(Refusal::bare(EngineCode::WindowNotFound))?;
        let placement = self
            .server()
            .window_placement(xid)
            .map_err(|error| failed(&error))?
            .ok_or(Refusal::bare(EngineCode::WindowNotFound))?;
        if placement.minimized {
            return Err(Refusal::new(EngineCode::CaptureUnavailable, Reason::Minimized.wire()));
        }
        if !placement.viewable {
            return Err(Refusal::new(EngineCode::CaptureUnavailable, Reason::Unmapped.wire()));
        }
        let read = PixmapRead::RedirectRefused;
        let (mut image, route, occluders_visible) = match read {
            PixmapRead::Image(raw) => (decode(&raw).map_err(|error| failed(&error))?, CaptureRoute::Composite, false),
            PixmapRead::RedirectRefused => (self.root_crop(&placement)?, CaptureRoute::RootCrop, true),
            PixmapRead::Unmapped => {
                return Err(Refusal::new(EngineCode::CaptureUnavailable, Reason::Unmapped.wire()));
            }
        };
        let cursor = CursorMode::None;
        if options.cursor {
            if let Some(glyph) = None::<super::server::CursorImage> {
                let rect = placement.rect;
                if rect.contains(glyph.x, glyph.y) {
                    let left = i64::from(glyph.x) - i64::from(rect.x) - i64::from(glyph.xhot);
                    let top = i64::from(glyph.y) - i64::from(rect.y) - i64::from(glyph.yhot);
                    blend_cursor(&mut image, &glyph, left, top);
                }
            }
        }
        let scale = self.window_scale(&placement)?;
        let origin = Rect {
            x: f64::from(placement.rect.x) / scale,
            y: f64::from(placement.rect.y) / scale,
            width: f64::from(placement.rect.width) / scale,
            height: f64::from(placement.rect.height) / scale,
        };
        let frame = CapturedFrame {
            image,
            route,
            occluders_visible,
            cursor,
            dropped: Vec::new(),
        };
        Ok((frame, origin, scale))
    }

    fn window_scale(&self, placement: &WindowPlacement) -> Result<f64, Refusal> {
        let readings = self.readings()?;
        let centre_x = placement.rect.x.saturating_add(i32::try_from(placement.rect.width / 2).unwrap_or(0));
        let centre_y = placement.rect.y.saturating_add(i32::try_from(placement.rect.height / 2).unwrap_or(0));
        Ok(readings
            .iter()
            .find(|reading| reading.monitor.rect.contains(centre_x, centre_y))
            .or_else(|| readings.first())
            .map_or(1.0, |reading| reading.scale))
    }

    fn root_crop(&self, placement: &WindowPlacement) -> Result<RgbaImage, Refusal> {
        let screen = self.server().screen();
        let rect = placement.rect;
        let visible = clip_to_screen(rect, screen.width, screen.height)
            .ok_or(Refusal::new(EngineCode::CaptureUnavailable, Reason::Unmapped.wire()))?;
        let raw = self.server().root_image(visible).map_err(|error| failed(&error))?;
        let pixels = decode(&raw).map_err(|error| failed(&error))?;
        let mut image = RgbaImage::new(rect.width, rect.height);
        imageops::replace(
            &mut image,
            &pixels,
            i64::from(visible.x) - i64::from(rect.x),
            i64::from(visible.y) - i64::from(rect.y),
        );
        Ok(image)
    }
}
