//! The SkyLight window capture (`SLSHWCaptureWindowList`, ledger row `hwcapture`, UNMEASURED):
//! one window's own pixels, behind its per-symbol probe and the session's opt-in.

use std::ffi::c_void;

use super::cf::{self, CfRef, CgPoint, CgRect, CgSize, Owned};
use super::symbols;
use crate::capture::seam::SkylightCapture;
use crate::capture::types::{CaptureFault, RawFrame};

/// `kCGSCaptureIgnoreGlobalClipShape` | best resolution.
const CAPTURE_OPTIONS: u32 = (1 << 11) | (1 << 8);
/// `kCGImageAlphaPremultipliedLast` | `kCGBitmapByteOrder32Big`: RGBA8888.
const RGBA_BITMAP_INFO: u32 = 1 | (4 << 12);

type MainConnection = unsafe extern "C" fn() -> i32;
type HwCapture = unsafe extern "C" fn(i32, *const u32, i32, u32) -> CfRef;

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGImageGetWidth(image: CfRef) -> usize;
    fn CGImageGetHeight(image: CfRef) -> usize;
    fn CGColorSpaceCreateDeviceRGB() -> CfRef;
    fn CGBitmapContextCreate(
        data: *mut c_void,
        width: usize,
        height: usize,
        bits: usize,
        row: usize,
        space: CfRef,
        info: u32,
    ) -> CfRef;
    fn CGContextDrawImage(context: CfRef, rect: CgRect, image: CfRef);
}

/// The resolved SkyLight capture symbols.
pub struct Skylight {
    connection: MainConnection,
    capture: HwCapture,
}

impl Skylight {
    /// Both symbols, or `None` when either does not resolve.
    pub fn probe() -> Option<Self> {
        Some(Self {
            connection: symbols::lookup(c"SLSMainConnectionID")?,
            capture: symbols::lookup(c"SLSHWCaptureWindowList")?,
        })
    }
}

impl SkylightCapture for Skylight {
    fn capture_window(&mut self, number: u32) -> Result<RawFrame, CaptureFault> {
        // SAFETY: the resolved symbols have these signatures; one window id is passed.
        let images = Owned::new(unsafe {
            (self.capture)((self.connection)(), &raw const number, 1, CAPTURE_OPTIONS)
        })
        .ok_or(CaptureFault::NullFrame)?;
        // SAFETY: the array holds CGImages only.
        if unsafe { cf::CFArrayGetCount(images.get()) } < 1 {
            return Err(CaptureFault::NullFrame);
        }
        // SAFETY: index 0 is in bounds; the image is owned by the array.
        rgba(unsafe { cf::CFArrayGetValueAtIndex(images.get(), 0) })
    }
}

fn rgba(image: CfRef) -> Result<RawFrame, CaptureFault> {
    // SAFETY: `image` is a CGImage.
    let (width, height) = unsafe { (CGImageGetWidth(image), CGImageGetHeight(image)) };
    let row = width.checked_mul(4).ok_or(CaptureFault::NullFrame)?;
    let mut buffer = vec![0u8; row.checked_mul(height).ok_or(CaptureFault::NullFrame)?];
    // SAFETY: plain call; +1 color space.
    let space =
        Owned::new(unsafe { CGColorSpaceCreateDeviceRGB() }).ok_or(CaptureFault::NullFrame)?;
    // SAFETY: `buffer` holds `row * height` bytes laid out as RGBA_BITMAP_INFO.
    let context = Owned::new(unsafe {
        CGBitmapContextCreate(
            buffer.as_mut_ptr().cast(),
            width,
            height,
            8,
            row,
            space.get(),
            RGBA_BITMAP_INFO,
        )
    })
    .ok_or(CaptureFault::NullFrame)?;
    #[allow(clippy::cast_precision_loss)]
    let rect = CgRect {
        origin: CgPoint::default(),
        size: CgSize {
            width: width as f64,
            height: height as f64,
        },
    };
    // SAFETY: the context draws into `buffer`, which outlives it.
    unsafe { CGContextDrawImage(context.get(), rect, image) };
    drop(context);
    Ok(RawFrame {
        width: u32::try_from(width).map_err(|_| CaptureFault::NullFrame)?,
        height: u32::try_from(height).map_err(|_| CaptureFault::NullFrame)?,
        rgba: buffer,
    })
}
