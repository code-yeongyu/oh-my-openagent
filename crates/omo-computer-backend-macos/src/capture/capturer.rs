//! The macOS capture entry point the backend delegates `windows()`, `displays()` and
//! `capture()` to.

use image::RgbaImage;
use omo_computer_core::backend::{
    BackendResult, CaptureOptions, FrameBytes, Refusal, Target, WindowFilter, WindowList,
};
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::observation::ImageMime;
use omo_computer_core::results::DisplayInfo;

use super::enumerate;
use super::pixels::{composite, crop, draw_crosshair, encode_png, Tile};
use super::route::{self, refusal, CaptureRouteTaken};
use super::seam::CaptureOs;
use crate::displays::{infos, scale};

/// Capture over one OS seam.
pub struct Capturer<O> {
    os: O,
    own_pid: u32,
    skylight_opt_in: bool,
    next_id: u64,
    last_route: Option<CaptureRouteTaken>,
}

impl<O: CaptureOs> Capturer<O> {
    /// `own_pid` is the engine's pid: its windows (overlay, receipt) are never listed and are
    /// excluded from every still.
    pub const fn new(os: O, own_pid: u32) -> Self {
        Self {
            os,
            own_pid,
            skylight_opt_in: false,
            next_id: 0,
            last_route: None,
        }
    }

    /// Lets the SkyLight window route run when its symbol resolved.
    #[must_use]
    pub const fn with_skylight_opt_in(mut self, opt_in: bool) -> Self {
        self.skylight_opt_in = opt_in;
        self
    }

    pub const fn os(&self) -> &O {
        &self.os
    }

    pub const fn os_mut(&mut self) -> &mut O {
        &mut self.os
    }

    /// The route of the last model frame; `None` after a refusal.
    pub const fn last_route(&self) -> Option<CaptureRouteTaken> {
        self.last_route
    }

    /// # Errors
    /// The window server answered no list.
    pub fn windows(&mut self, filter: &WindowFilter) -> BackendResult<WindowList> {
        enumerate::list(&mut self.os, self.own_pid, filter)
    }

    /// # Errors
    /// The display list cannot be read.
    pub fn displays(&mut self) -> BackendResult<Vec<DisplayInfo>> {
        Ok(infos(&self.os.displays()?))
    }

    /// One model-bound frame: a still, never a stream frame.
    ///
    /// # Errors
    /// `WindowNotFound`, `CaptureUnavailable{minimized}` with nothing captured, `InvalidTarget`
    /// for an unknown display, or the route's refusal.
    pub fn capture(
        &mut self,
        target: &Target,
        options: &CaptureOptions,
    ) -> BackendResult<FrameBytes> {
        self.last_route = None;
        let (mut image, scale) = match target {
            Target::Window(id) => self.window(id, options.cursor)?,
            Target::Display(id) => self.display(id, options.cursor)?,
            Target::Desktop => self.desktop(options.cursor)?,
        };
        if let Some(region) = &options.region {
            image = crop(&image, region, scale);
        }
        if let Some(point) = options.crosshair {
            draw_crosshair(&mut image, point, scale);
        }
        let bytes = encode_png(&image).map_err(refusal)?;
        Ok(FrameBytes {
            width: image.width(),
            height: image.height(),
            mime: ImageMime::Png,
            bytes,
        })
    }

    fn id(&mut self) -> u64 {
        self.next_id += 1;
        self.next_id
    }

    fn window(&mut self, id: &str, cursor: bool) -> BackendResult<(RgbaImage, f64)> {
        let listed = enumerate::find(&mut self.os, self.own_pid, id)?;
        if listed.minimized {
            return Err(Refusal::new(
                EngineCode::CaptureUnavailable,
                Reason::Minimized,
            ));
        }
        let number = listed
            .info
            .identity
            .window_number
            .and_then(|n| u32::try_from(n).ok());
        let number = number.ok_or(Refusal::bare(EngineCode::WindowNotFound))?;
        let request = self.id();
        let (image, taken) =
            route::window_still(&mut self.os, request, number, cursor, self.skylight_opt_in)?;
        self.last_route = Some(taken);
        let points = listed.info.bounds.width;
        let scale = if points > 0.0 {
            f64::from(image.width()) / points
        } else {
            1.0
        };
        Ok((image, scale))
    }

    fn display(&mut self, id: &str, cursor: bool) -> BackendResult<(RgbaImage, f64)> {
        let records = self.os.displays()?;
        let record = records
            .iter()
            .find(|d| d.id.to_string() == id)
            .ok_or(Refusal::bare(EngineCode::InvalidTarget))?;
        let exclude = enumerate::own_on_screen(&mut self.os, self.own_pid)?;
        let request = self.id();
        let image = route::display_still(&mut self.os, request, record.id, cursor, &exclude)?;
        self.last_route = Some(CaptureRouteTaken::Helper);
        Ok((image, scale(record)))
    }

    fn desktop(&mut self, cursor: bool) -> BackendResult<(RgbaImage, f64)> {
        let records = self.os.displays()?;
        if records.is_empty() {
            return Err(Refusal::bare(EngineCode::InvalidTarget));
        }
        let exclude = enumerate::own_on_screen(&mut self.os, self.own_pid)?;
        let mut tiles = Vec::with_capacity(records.len());
        for record in &records {
            let request = self.id();
            let image = route::display_still(&mut self.os, request, record.id, cursor, &exclude)?;
            tiles.push(Tile {
                bounds: record.bounds,
                image,
            });
        }
        let top = records.iter().map(scale).fold(1.0, f64::max);
        self.last_route = Some(CaptureRouteTaken::Helper);
        Ok((composite(&tiles, top), top))
    }
}
