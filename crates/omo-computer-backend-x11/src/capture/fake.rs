//! An in-memory X server for the capture tests: a root image the desktop shows (occluders
//! included), each window's own pixels, a compositor flag and an XFixes cursor.

use std::cell::Cell;

use image::{Rgba, RgbaImage};

use super::server::{
    ChannelMasks, ClientWindow, CursorImage, Monitor, PixelRect, PixmapRead, Screen, WindowPlacement, XError,
    XServer, ZImage,
};

pub const MAGENTA: Rgba<u8> = Rgba([255, 0, 255, 255]);
pub const GREEN: Rgba<u8> = Rgba([0, 200, 0, 255]);
pub const BLUE: Rgba<u8> = Rgba([0, 0, 220, 255]);
pub const RED: Rgba<u8> = Rgba([255, 0, 0, 255]);

const MASKS: ChannelMasks = ChannelMasks {
    red: 0x00FF_0000,
    green: 0x0000_FF00,
    blue: 0x0000_00FF,
};

pub struct FakeWindow {
    pub xid: u32,
    pub rect: PixelRect,
    pub own: RgbaImage,
    pub viewable: bool,
    pub minimized: bool,
}

pub struct FakeX {
    pub screen: Screen,
    pub monitors: Vec<Monitor>,
    pub resources: Option<String>,
    pub root: RgbaImage,
    pub windows: Vec<FakeWindow>,
    pub compositor: bool,
    pub composite_extension: bool,
    pub cursor: Option<CursorImage>,
    pub redirects: Cell<u32>,
    /// Row 50: `_NET_WM_PID` per window xid.
    pub pids: Vec<(u32, u32)>,
}

fn mm_at_96_dpi(pixels: u32) -> u32 {
    (pixels * 254).div_ceil(960)
}

fn monitor(atom: u32, name: &str, primary: bool, rect: PixelRect) -> Monitor {
    Monitor {
        atom,
        name: name.to_owned(),
        primary,
        rect,
        width_mm: mm_at_96_dpi(rect.width),
        height_mm: mm_at_96_dpi(rect.height),
    }
}

/// ZPixmap bytes of 32 bits per pixel, LSB first, as an Xvfb root of depth 24 sends them.
pub fn zimage(image: &RgbaImage) -> ZImage {
    let data = image
        .pixels()
        .flat_map(|pixel| [pixel.0[2], pixel.0[1], pixel.0[0], 0])
        .collect();
    ZImage {
        width: image.width(),
        height: image.height(),
        bits_per_pixel: 32,
        scanline_pad: 32,
        msb_first: false,
        masks: MASKS,
        data,
    }
}

impl FakeX {
    pub fn single(width: u32, height: u32) -> Self {
        let rect = PixelRect {
            x: 0,
            y: 0,
            width,
            height,
        };
        Self {
            screen: Screen {
                root: 1,
                width,
                height,
                width_mm: mm_at_96_dpi(width),
                height_mm: mm_at_96_dpi(height),
            },
            monitors: vec![monitor(10, "DP-1", true, rect)],
            resources: None,
            root: RgbaImage::from_pixel(width, height, BLUE),
            windows: Vec::new(),
            compositor: true,
            composite_extension: true,
            cursor: None,
            redirects: Cell::new(0),
            pids: Vec::new(),
        }
    }

    pub fn two_screens() -> Self {
        let mut server = Self::single(2304, 800);
        server.monitors = vec![
            monitor(10, "DP-1", true, PixelRect { x: 0, y: 0, width: 1280, height: 800 }),
            monitor(11, "HDMI-1", false, PixelRect { x: 1280, y: 0, width: 1024, height: 768 }),
        ];
        server
    }

    pub fn with_resources(mut self, resources: &str) -> Self {
        self.resources = Some(resources.to_owned());
        self
    }

    pub fn without_randr(mut self) -> Self {
        self.monitors.clear();
        self
    }

    /// Adds a window of `own` colour at `rect` and paints it on the root.
    pub fn with_window(mut self, xid: u32, rect: PixelRect, own: Rgba<u8>) -> Self {
        paint(&mut self.root, rect, own);
        self.windows.push(FakeWindow {
            xid,
            rect,
            own: RgbaImage::from_pixel(rect.width, rect.height, own),
            viewable: true,
            minimized: false,
        });
        self
    }

    /// Paints a covering window on the root only: the target's own pixmap never shows it.
    pub fn with_occluder(mut self, rect: PixelRect) -> Self {
        paint(&mut self.root, rect, MAGENTA);
        self
    }

    pub fn with_cursor(mut self, x: i32, y: i32, hot: u32, size: u32) -> Self {
        let argb = vec![0xFFFF_0000; (size * size) as usize];
        self.cursor = Some(CursorImage {
            x,
            y,
            xhot: hot,
            yhot: hot,
            width: size,
            height: size,
            argb,
        });
        self
    }
}

pub fn paint(image: &mut RgbaImage, rect: PixelRect, colour: Rgba<u8>) {
    for (x, y, pixel) in image.enumerate_pixels_mut() {
        let (x, y) = (i32::try_from(x).unwrap_or(i32::MAX), i32::try_from(y).unwrap_or(i32::MAX));
        if rect.contains(x, y) {
            *pixel = colour;
        }
    }
}

impl XServer for FakeX {
    fn screen(&self) -> Screen {
        self.screen
    }

    fn composite_available(&self) -> bool {
        self.composite_extension
    }

    fn monitors(&self) -> Result<Vec<Monitor>, XError> {
        Ok(self.monitors.clone())
    }

    fn resource_manager(&self) -> Result<Option<String>, XError> {
        Ok(self.resources.clone())
    }

    fn root_image(&self, rect: PixelRect) -> Result<ZImage, XError> {
        let x = u32::try_from(rect.x).map_err(|_| XError("negative x".into()))?;
        let y = u32::try_from(rect.y).map_err(|_| XError("negative y".into()))?;
        if x + rect.width > self.root.width() || y + rect.height > self.root.height() {
            return Err(XError("BadMatch: rect outside the root".into()));
        }
        let crop = image::imageops::crop_imm(&self.root, x, y, rect.width, rect.height).to_image();
        Ok(zimage(&crop))
    }

    fn window_placement(&self, window: u32) -> Result<Option<WindowPlacement>, XError> {
        Ok(self.windows.iter().find(|w| w.xid == window).map(|w| WindowPlacement {
            rect: w.rect,
            border: 0,
            viewable: w.viewable,
            minimized: w.minimized,
            visual: 33,
        }))
    }

    fn compositor_present(&self) -> Result<bool, XError> {
        Ok(self.compositor)
    }

    fn window_pixmap(
        &self,
        window: u32,
        _placement: &WindowPlacement,
        redirect: bool,
    ) -> Result<PixmapRead, XError> {
        if !self.composite_extension {
            return Ok(PixmapRead::RedirectRefused);
        }
        if redirect {
            self.redirects.set(self.redirects.get() + 1);
        }
        Ok(self
            .windows
            .iter()
            .find(|w| w.xid == window)
            .filter(|w| w.viewable)
            .map_or(PixmapRead::Unmapped, |w| PixmapRead::Image(zimage(&w.own))))
    }

    fn client_windows(&self) -> Result<Vec<ClientWindow>, XError> {
        Ok(self
            .windows
            .iter()
            .rev()
            .map(|w| ClientWindow {
                xid: w.xid,
                title: format!("window {}", w.xid),
                class: "Fake".to_owned(),
                pid: self.pids.iter().find(|(xid, _)| *xid == w.xid).map(|(_, pid)| *pid),
                focused: false,
                desktop: None,
                placement: WindowPlacement {
                    rect: w.rect,
                    border: 0,
                    viewable: w.viewable,
                    minimized: w.minimized,
                    visual: 33,
                },
            })
            .collect())
    }

    fn cursor(&self) -> Result<Option<CursorImage>, XError> {
        Ok(self.cursor.clone())
    }
}
