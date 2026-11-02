//! Display-only fallback when `screencapture` is absent or fails with Screen
//! Recording granted: `CGDisplayCreateImage(CGMainDisplayID())` through raw
//! CoreGraphics FFI (ported from gajae-code `computer/capture.rs`). Every Core
//! Graphics handle is owned by an RAII guard and released exactly once.

use std::ffi::c_void;
use std::ptr::NonNull;

use image::RgbaImage;
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::types::DesktopDisplay;

use super::{capture_permission, permission_denied};

#[repr(C)]
#[derive(Clone, Copy)]
struct CgPoint {
    x: f64,
    y: f64,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct CgSize {
    width: f64,
    height: f64,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct CgRect {
    origin: CgPoint,
    size: CgSize,
}

/// `kCGImageAlphaPremultipliedLast` (1) | `kCGBitmapByteOrder32Big` (4 << 12):
/// an RGBA8888 byte layout.
const RGBA_BITMAP_INFO: u32 = 1 | (4 << 12);
const BITS_PER_COMPONENT: usize = 8;
const BYTES_PER_PIXEL: usize = 4;

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    safe fn CGMainDisplayID() -> u32;
    safe fn CGDisplayCreateImage(display: u32) -> *mut c_void;
    safe fn CGColorSpaceCreateDeviceRGB() -> *mut c_void;
    fn CGImageGetWidth(image: *mut c_void) -> usize;
    fn CGImageGetHeight(image: *mut c_void) -> usize;
    fn CGImageRelease(image: *mut c_void);
    fn CGColorSpaceRelease(space: *mut c_void);
    fn CGBitmapContextCreate(
        data: *mut c_void,
        width: usize,
        height: usize,
        bits_per_component: usize,
        bytes_per_row: usize,
        space: *mut c_void,
        bitmap_info: u32,
    ) -> *mut c_void;
    fn CGContextDrawImage(context: *mut c_void, rect: CgRect, image: *mut c_void);
    fn CGContextRelease(context: *mut c_void);
}

/// An owned (+1 retained) Core Graphics reference released on drop.
struct Owned {
    handle: NonNull<c_void>,
    release: unsafe extern "C" fn(*mut c_void),
}

impl Owned {
    fn new(raw: *mut c_void, release: unsafe extern "C" fn(*mut c_void)) -> Option<Self> {
        NonNull::new(raw).map(|handle| Self { handle, release })
    }

    fn as_ptr(&self) -> *mut c_void {
        self.handle.as_ptr()
    }
}

impl Drop for Owned {
    fn drop(&mut self) {
        // SAFETY: [Category 12 - double free] `handle` came from a Create/Copy
        // call whose ownership this guard took exactly once, and `release` is
        // that type's matching release function; drop runs once.
        unsafe { (self.release)(self.handle.as_ptr()) }
    }
}

/// Captures the primary display with CoreGraphics and frames it as the only
/// display of the capture. Logs the fallback decision once.
pub(crate) fn capture_primary(
    displays: &[DesktopDisplay],
    reason: &str,
) -> CoreResult<(RgbaImage, FrameGeometry)> {
    let primary = displays.iter().find(|display| display.is_primary).ok_or_else(|| {
        DesktopError::capture_failed(format!(
            "screencapture failed ({reason}) and the CoreGraphics fallback covers only the primary display, which is not selected"
        ))
    })?;
    eprintln!("senpi-desktop-backend-macos: capture: fallback=CGDisplayCreateImage reason={reason}");
    let image = main_display_image()?;
    let display = DesktopDisplay {
        pixel_x: 0,
        pixel_y: 0,
        pixel_width: image.width(),
        pixel_height: image.height(),
        ..primary.clone()
    };
    Ok((image, FrameGeometry::for_displays(std::slice::from_ref(&display))))
}

fn main_display_image() -> CoreResult<RgbaImage> {
    let image = Owned::new(CGDisplayCreateImage(CGMainDisplayID()), CGImageRelease).ok_or_else(|| {
        if capture_permission() {
            DesktopError::capture_failed("CGDisplayCreateImage returned no image")
        } else {
            permission_denied()
        }
    })?;
    // SAFETY: [Category 8 - FFI] `image` is a live non-null CGImageRef.
    let width = unsafe { CGImageGetWidth(image.as_ptr()) };
    // SAFETY: [Category 8 - FFI] `image` is a live non-null CGImageRef.
    let height = unsafe { CGImageGetHeight(image.as_ptr()) };
    let (Ok(px_width), Ok(px_height)) = (u32::try_from(width), u32::try_from(height)) else {
        return Err(DesktopError::capture_failed(
            "CGDisplayCreateImage size overflows u32",
        ));
    };
    if px_width == 0 || px_height == 0 {
        return Err(DesktopError::capture_failed(
            "CGDisplayCreateImage returned an empty image",
        ));
    }
    let bytes_per_row = width
        .checked_mul(BYTES_PER_PIXEL)
        .ok_or_else(|| DesktopError::capture_failed("CGDisplayCreateImage row size overflow"))?;
    let len = bytes_per_row
        .checked_mul(height)
        .ok_or_else(|| DesktopError::capture_failed("CGDisplayCreateImage buffer size overflow"))?;
    let mut buffer = vec![0u8; len];
    let space = Owned::new(CGColorSpaceCreateDeviceRGB(), CGColorSpaceRelease)
        .ok_or_else(|| DesktopError::capture_failed("CGColorSpaceCreateDeviceRGB returned null"))?;
    // SAFETY: [Category 10 - out of bounds] `buffer` holds exactly
    // `bytes_per_row * height` bytes, matching the width/height/stride passed
    // here, and outlives the context (dropped at the end of this scope first).
    let raw_context = unsafe {
        CGBitmapContextCreate(
            buffer.as_mut_ptr().cast::<c_void>(),
            width,
            height,
            BITS_PER_COMPONENT,
            bytes_per_row,
            space.as_ptr(),
            RGBA_BITMAP_INFO,
        )
    };
    let context = Owned::new(raw_context, CGContextRelease)
        .ok_or_else(|| DesktopError::capture_failed("CGBitmapContextCreate returned null"))?;
    let rect = CgRect {
        origin: CgPoint { x: 0.0, y: 0.0 },
        size: CgSize {
            width: f64::from(px_width),
            height: f64::from(px_height),
        },
    };
    // SAFETY: [Category 10 - out of bounds] `context` and `image` are live and
    // non-null; `rect` equals the bitmap the context draws into.
    unsafe { CGContextDrawImage(context.as_ptr(), rect, image.as_ptr()) };
    drop(context);
    RgbaImage::from_raw(px_width, px_height, buffer)
        .ok_or_else(|| DesktopError::capture_failed("CoreGraphics bitmap size mismatch"))
}
