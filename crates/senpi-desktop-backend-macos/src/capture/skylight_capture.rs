//! SkyLight window capture through `SLSHWCaptureWindowList`, which reads a
//! window's own backing store and so also captures windows on other Spaces.
//! The symbol is optional: without it (or with
//! `SENPI_DESKTOP_DISABLE_SKYLIGHT=1`) window capture stays on the public
//! ScreenCaptureKit/`screencapture` chain.

use std::ffi::c_void;
use std::ptr::NonNull;

use image::RgbaImage;
use objc2_core_foundation::{
    CFArray, CFBoolean, CFDictionary, CFNumber, CFRetained, CFString, CFType,
};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::types::DesktopWindow;

/// `kCGSCaptureIgnoreGlobalClipShape` (1 << 11) | best resolution (1 << 8).
const CAPTURE_OPTIONS: u32 = (1 << 11) | (1 << 8);
const WINDOW_LIST_OPTION_INCLUDING_WINDOW: u32 = 1 << 3;
/// `kCGImageAlphaPremultipliedLast` | `kCGBitmapByteOrder32Big`: RGBA8888.
const RGBA_BITMAP_INFO: u32 = 1 | (4 << 12);
const BYTES_PER_PIXEL: usize = 4;

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

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGWindowListCopyWindowInfo(options: u32, relative_to_window: u32) -> *mut CFArray;
    fn CGImageGetWidth(image: *mut c_void) -> usize;
    fn CGImageGetHeight(image: *mut c_void) -> usize;
    safe fn CGColorSpaceCreateDeviceRGB() -> *mut c_void;
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

/// Whether `SLSHWCaptureWindowList` resolved (and SkyLight is not disabled).
pub(crate) fn available() -> bool {
    #[cfg(test)]
    if let Some(fake) = TEST_CAPTURE.with(std::cell::Cell::get) {
        return fake.is_some();
    }
    crate::skylight::capture_spi().is_some_and(|spi| spi.hw_capture.is_some())
}

/// The window's current listing, read before a capture so a refusal can be
/// decided without touching the backing store.
pub(crate) fn listing(window_id: u32) -> CoreResult<DesktopWindow> {
    #[cfg(test)]
    if TEST_CAPTURE.with(std::cell::Cell::get).is_some() {
        return Ok(test_window(window_id));
    }
    window_info(window_id)
}

/// One SkyLight capture of `window_id`.
pub(crate) fn capture(window_id: u32) -> CoreResult<RgbaImage> {
    #[cfg(test)]
    if let Some(fake) = TEST_CAPTURE.with(std::cell::Cell::get) {
        let fake = fake.ok_or_else(|| DesktopError::capture_failed("SkyLight capture is unavailable"))?;
        return fake(window_id);
    }
    capture_image(window_id)
}

/// True for an empty image or one whose every pixel has zero alpha, the frame
/// a capture of an undrawn or off-Space backing store can return.
pub(crate) fn fully_transparent(image: &RgbaImage) -> bool {
    image.pixels().all(|pixel| pixel.0[3] == 0)
}

fn capture_image(window_id: u32) -> CoreResult<RgbaImage> {
    let spi = crate::skylight::capture_spi()
        .ok_or_else(|| DesktopError::capture_failed("SkyLight is unavailable"))?;
    let hw_capture = spi
        .hw_capture
        .ok_or_else(|| DesktopError::capture_failed("SLSHWCaptureWindowList is unavailable"))?;
    // SAFETY: the resolved symbol takes no arguments.
    let connection = unsafe { (spi.main_connection)() };
    // SAFETY: `window_id` is one readable u32 for the duration of the call;
    // the result is a create-rule CFArray (or null) owned below.
    let raw = unsafe { hw_capture(connection, &window_id, 1, CAPTURE_OPTIONS) };
    let raw = NonNull::new(raw.cast_mut().cast::<CFArray>())
        .ok_or_else(|| DesktopError::capture_failed(format!("SkyLight returned no image for window {window_id}")))?;
    // SAFETY: a non-null +1 CFArray this function now owns.
    let images: CFRetained<CFArray> = unsafe { CFRetained::from_raw(raw) };
    // SAFETY: SLSHWCaptureWindowList fills its array with CGImages only.
    let images = unsafe { CFRetained::cast_unchecked::<CFArray<CFType>>(images) };
    let image = images
        .get(0)
        .ok_or_else(|| DesktopError::capture_failed(format!("SkyLight returned no image for window {window_id}")))?;
    rgba(CFRetained::as_ptr(&image).as_ptr().cast::<c_void>())
}

/// Copies a live CGImage into an RGBA8888 buffer.
fn rgba(image: *mut c_void) -> CoreResult<RgbaImage> {
    // SAFETY: `image` is a live CGImage kept alive by the caller's array element.
    let (width, height) = unsafe { (CGImageGetWidth(image), CGImageGetHeight(image)) };
    let (Ok(px_width), Ok(px_height)) = (u32::try_from(width), u32::try_from(height)) else {
        return Err(DesktopError::capture_failed("SkyLight image size overflows u32"));
    };
    if px_width == 0 || px_height == 0 {
        return Err(DesktopError::capture_failed("SkyLight returned an empty image"));
    }
    let bytes_per_row = width
        .checked_mul(BYTES_PER_PIXEL)
        .ok_or_else(|| DesktopError::capture_failed("SkyLight image row size overflow"))?;
    let len = bytes_per_row
        .checked_mul(height)
        .ok_or_else(|| DesktopError::capture_failed("SkyLight image buffer size overflow"))?;
    let mut buffer = vec![0u8; len];
    let space = CGColorSpaceCreateDeviceRGB();
    if space.is_null() {
        return Err(DesktopError::capture_failed("CGColorSpaceCreateDeviceRGB returned null"));
    }
    // SAFETY: `buffer` holds exactly `bytes_per_row * height` bytes matching the
    // geometry passed here and outlives the context released below.
    let context = unsafe {
        CGBitmapContextCreate(buffer.as_mut_ptr().cast(), width, height, 8, bytes_per_row, space, RGBA_BITMAP_INFO)
    };
    // SAFETY: `space` came from a Create call and is released exactly once.
    unsafe { CGColorSpaceRelease(space) };
    if context.is_null() {
        return Err(DesktopError::capture_failed("CGBitmapContextCreate returned null"));
    }
    let rect = CgRect {
        origin: CgPoint { x: 0.0, y: 0.0 },
        size: CgSize { width: f64::from(px_width), height: f64::from(px_height) },
    };
    // SAFETY: `context` and `image` are live and `rect` equals the bitmap; the
    // context came from a Create call and is released exactly once.
    unsafe {
        CGContextDrawImage(context, rect, image);
        CGContextRelease(context);
    }
    RgbaImage::from_raw(px_width, px_height, buffer)
        .ok_or_else(|| DesktopError::capture_failed("SkyLight bitmap size mismatch"))
}

/// The WindowServer listing of `window_id`, whatever Space it is on.
fn window_info(window_id: u32) -> CoreResult<DesktopWindow> {
    // SAFETY: CoreGraphics returns a create-rule CFArray of window dictionaries (or null).
    let raw = unsafe { CGWindowListCopyWindowInfo(WINDOW_LIST_OPTION_INCLUDING_WINDOW, window_id) };
    let raw = NonNull::new(raw)
        .ok_or_else(|| DesktopError::capture_failed("copying the WindowServer window list failed"))?;
    // SAFETY: a non-null +1 CFArray this function now owns.
    let array: CFRetained<CFArray> = unsafe { CFRetained::from_raw(raw) };
    // SAFETY: each entry of the window-info array is a CFDictionary.
    let array = unsafe { CFRetained::cast_unchecked::<CFArray<CFDictionary>>(array) };
    let key = |name: &str| CFString::from_str(name);
    let number = |entry: &CFDictionary<CFString, CFType>, name: &str| {
        entry.get(&key(name))?.downcast::<CFNumber>().ok()?.as_f64()
    };
    for entry in array.iter() {
        // SAFETY: window-info dictionaries have CFString keys and CFType values;
        // every read below downcasts and rejects a wrong type.
        let entry = unsafe { CFRetained::cast_unchecked::<CFDictionary<CFString, CFType>>(entry) };
        if number(&entry, "kCGWindowNumber") != Some(f64::from(window_id)) {
            continue;
        }
        let bounds = entry
            .get(&key("kCGWindowBounds"))
            .and_then(|bounds| bounds.downcast::<CFDictionary>().ok())
            .ok_or_else(|| DesktopError::capture_failed(format!("window {window_id} has no bounds")))?;
        // SAFETY: kCGWindowBounds is a CFString -> CFNumber dictionary.
        let bounds = unsafe { CFRetained::cast_unchecked::<CFDictionary<CFString, CFType>>(bounds) };
        let field = |name: &str| number(&bounds, name).unwrap_or(0.0);
        let text = |name: &str| {
            entry
                .get(&key(name))
                .and_then(|value| value.downcast::<CFString>().ok())
                .map(|value| value.to_string())
                .unwrap_or_default()
        };
        return Ok(DesktopWindow {
            identity: None,
            id: window_id.to_string(),
            title: text("kCGWindowName"),
            app: text("kCGWindowOwnerName"),
            pid: number(&entry, "kCGWindowOwnerPID").map(|pid| pid as u32),
            x: field("X").round() as i32,
            y: field("Y").round() as i32,
            width: field("Width").round() as u32,
            height: field("Height").round() as u32,
            focused: false,
            is_on_screen: Some(
                entry
                    .get(&key("kCGWindowIsOnscreen"))
                    .and_then(|value| value.downcast::<CFBoolean>().ok())
                    .is_some_and(|value| value.as_bool()),
            ),
            elevated: None,
        });
    }
    Err(DesktopError::window_not_found(format!(
        "window '{window_id}' was not found; it may be closed"
    )))
}

#[cfg(test)]
type FakeShot = fn(u32) -> CoreResult<RgbaImage>;

#[cfg(test)]
thread_local! {
    /// `Some(None)`: unavailable (the test default); `Some(Some(f))`: `f`
    /// answers; `None`: the real SPI.
    static TEST_CAPTURE: std::cell::Cell<Option<Option<FakeShot>>> =
        const { std::cell::Cell::new(Some(None)) };
}

#[cfg(test)]
pub(crate) fn override_capture(fake: Option<Option<FakeShot>>) {
    TEST_CAPTURE.with(|cell| cell.set(fake));
}

#[cfg(test)]
fn test_window(window_id: u32) -> DesktopWindow {
    DesktopWindow {
        identity: None,
        id: window_id.to_string(),
        title: String::new(),
        app: String::new(),
        pid: Some(7),
        x: 10,
        y: 20,
        width: 40,
        height: 20,
        focused: false,
        is_on_screen: Some(false),
        elevated: None,
    }
}

#[cfg(test)]
mod route_tests {
    use std::sync::atomic::Ordering;
    use std::time::Duration;

    use image::{Rgba, RgbaImage};
    use senpi_desktop_core::error::{CoreResult, DesktopError, ErrorCode};
    use senpi_desktop_core::types::{DisplaySelector, Target};

    use super::override_capture;
    use crate::capture::minimized::override_probe;
    use crate::capture::route::test_support::override_availability;
    use crate::capture::route::{plan_window_route, CaptureRoute, WindowRoute, LAST_ROUTE};
    use crate::capture::sck::{self, SckCaptureError, SckFrame, SckTargetRequest};
    use crate::capture::spaces::{override_placement, SpacePlacement};
    use crate::capture::{MacCapture, Screencapture};

    fn capture() -> MacCapture {
        let shooter = Screencapture::with(std::path::PathBuf::from("/usr/bin/true"), Duration::from_secs(60), || true);
        MacCapture::new(DisplaySelector::All, shooter)
    }

    fn opaque(_window: u32) -> CoreResult<RgbaImage> {
        Ok(RgbaImage::from_pixel(4, 2, Rgba([9, 8, 7, 255])))
    }

    fn transparent(_window: u32) -> CoreResult<RgbaImage> {
        Ok(RgbaImage::from_pixel(4, 2, Rgba([0, 0, 0, 0])))
    }

    fn failing(_window: u32) -> CoreResult<RgbaImage> {
        Err(DesktopError::capture_failed("SkyLight returned no image"))
    }

    fn skylight_window(
        shot: Option<fn(u32) -> CoreResult<RgbaImage>>,
        placement: SpacePlacement,
    ) -> CoreResult<Option<(RgbaImage, senpi_desktop_core::frame::FrameGeometry)>> {
        override_capture(Some(shot));
        override_placement(Some(placement));
        override_probe(Some(|_, _| None));
        let result = capture().capture_via_skylight(&Target::Window("42".to_owned()), &[]);
        override_probe(None);
        override_capture(Some(None));
        override_placement(Some(SpacePlacement::Unknown));
        result
    }

    #[test]
    fn a_minimized_window_is_refused_on_the_skylight_route_too() {
        override_capture(Some(Some(opaque)));
        override_placement(Some(SpacePlacement::Current));
        override_probe(Some(|pid, window| (pid == 7 && window == 42).then_some(true)));
        let result = capture().capture_via_skylight(&Target::Window("42".to_owned()), &[]);
        override_probe(None);
        override_capture(Some(None));
        override_placement(Some(SpacePlacement::Unknown));
        let error = result.unwrap_err();
        assert_eq!(error.code, ErrorCode::CaptureUnavailable, "{}", error.message);
        assert_eq!(error.capture_unavailable.map(|data| data.reason).as_deref(), Some("minimized"));
    }

    fn off_space_reason(error: DesktopError) -> Option<String> {
        assert_eq!(error.code, ErrorCode::CaptureUnavailable, "{}", error.message);
        error.capture_unavailable.map(|data| data.reason)
    }

    #[test]
    fn the_route_plan_covers_every_symbol_and_space_case() {
        let cases = [
            (true, SpacePlacement::Current, WindowRoute::SkyLightFirst),
            (true, SpacePlacement::Unknown, WindowRoute::SkyLightFirst),
            (true, SpacePlacement::Other, WindowRoute::SkyLightOnly),
            (false, SpacePlacement::Current, WindowRoute::Public),
            (false, SpacePlacement::Unknown, WindowRoute::Public),
            (false, SpacePlacement::Other, WindowRoute::OffSpaceUnavailable),
        ];
        for (skylight, placement, expected) in cases {
            assert_eq!(plan_window_route(skylight, placement), expected, "{skylight} {placement:?}");
        }
    }

    #[test]
    fn a_missing_symbol_hands_a_current_space_window_to_the_public_chain() {
        let result = skylight_window(None, SpacePlacement::Current);
        assert!(matches!(result, Ok(None)), "{result:?}");
    }

    #[test]
    fn a_transparent_skylight_frame_falls_back_on_the_current_space() {
        let result = skylight_window(Some(transparent), SpacePlacement::Current);
        assert!(matches!(result, Ok(None)), "{result:?}");
    }

    #[test]
    fn a_skylight_error_falls_back_on_the_current_space() {
        let result = skylight_window(Some(failing), SpacePlacement::Unknown);
        assert!(matches!(result, Ok(None)), "{result:?}");
    }

    #[test]
    fn an_opaque_skylight_frame_is_returned_as_a_non_legacy_window_frame() {
        let (image, geometry) = skylight_window(Some(opaque), SpacePlacement::Current).unwrap().unwrap();
        assert_eq!((image.width(), image.height()), (4, 2));
        assert!(!geometry.is_legacy_capture());
    }

    #[test]
    fn an_off_space_window_is_captured_through_skylight_only() {
        let captured = skylight_window(Some(opaque), SpacePlacement::Other).unwrap();
        assert!(captured.is_some());
        for shot in [transparent as fn(u32) -> CoreResult<RgbaImage>, failing] {
            let error = skylight_window(Some(shot), SpacePlacement::Other).unwrap_err();
            assert_eq!(off_space_reason(error).as_deref(), Some("off-space"));
        }
    }

    #[test]
    fn an_off_space_window_without_skylight_capture_is_capture_unavailable() {
        let error = skylight_window(None, SpacePlacement::Other).unwrap_err();
        assert_eq!(off_space_reason(error).as_deref(), Some("off-space"));
    }

    #[test]
    fn a_cursor_helper_is_refused_before_skylight_runs() {
        override_capture(Some(Some(opaque)));
        override_placement(Some(SpacePlacement::Current));
        let result = capture().capture_via_skylight(&Target::Window("42".to_owned()), &[42]);
        override_capture(Some(None));
        override_placement(Some(SpacePlacement::Unknown));
        assert_eq!(result.unwrap_err().code, ErrorCode::CaptureFailed);
    }

    #[test]
    fn display_targets_never_take_the_skylight_route() {
        override_capture(Some(Some(opaque)));
        let result = capture().capture_via_skylight(&Target::Desktop, &[]);
        override_capture(Some(None));
        assert!(matches!(result, Ok(None)), "{result:?}");
    }

    fn sck_frames(_requests: &[SckTargetRequest]) -> Result<Vec<SckFrame>, SckCaptureError> {
        Ok(vec![SckFrame {
            image: RgbaImage::from_pixel(4, 2, Rgba([1, 2, 3, 255])),
            bounds: (10.0, 20.0, 40.0, 20.0),
            is_on_screen: Some(true),
            pid: None,
        }])
    }

    fn transparent_off_screen_sck(_requests: &[SckTargetRequest]) -> Result<Vec<SckFrame>, SckCaptureError> {
        Ok(vec![SckFrame {
            image: RgbaImage::from_pixel(4, 2, Rgba([0, 0, 0, 0])),
            bounds: (10.0, 20.0, 40.0, 20.0),
            is_on_screen: Some(false),
            pid: Some(7),
        }])
    }

    fn last_route() -> u8 {
        LAST_ROUTE.with(|store| store.load(Ordering::Relaxed))
    }

    #[test]
    fn the_route_that_produced_the_frame_is_recorded() {
        override_availability(Some(Ok(())));
        sck::override_capture(Some(sck_frames));
        override_placement(Some(SpacePlacement::Current));
        override_capture(Some(Some(opaque)));
        override_probe(Some(|_, _| None));
        let skylight = capture().capture_with_exclusions(&Target::Window("42".to_owned()), &[]);
        let skylight_route = last_route();
        override_capture(Some(Some(transparent)));
        let sck = capture().capture_with_exclusions(&Target::Window("42".to_owned()), &[]);
        let sck_route = last_route();
        override_probe(None);
        override_capture(Some(None));
        override_placement(Some(SpacePlacement::Unknown));
        sck::override_capture(None);
        override_availability(None);
        skylight.unwrap();
        sck.unwrap();
        assert_eq!(skylight_route, CaptureRoute::SkyLight as u8);
        assert_eq!(sck_route, CaptureRoute::Sck as u8);
    }

    fn transparent_off_screen_sck_reason(placement: SpacePlacement) -> Option<String> {
        override_availability(Some(Ok(())));
        sck::override_capture(Some(transparent_off_screen_sck));
        override_probe(Some(|_, _| Some(false)));
        override_placement(Some(placement));
        let result = capture().capture_via_sck(&Target::Window("42".to_owned()), &[], &[]);
        override_placement(Some(SpacePlacement::Unknown));
        override_probe(None);
        sck::override_capture(None);
        override_availability(None);
        off_space_reason(result.unwrap_err())
    }

    #[test]
    fn a_transparent_off_screen_sck_frame_is_refused_as_off_space_only_when_placed_elsewhere() {
        assert_eq!(transparent_off_screen_sck_reason(SpacePlacement::Other).as_deref(), Some("off-space"));
        for placement in [SpacePlacement::Current, SpacePlacement::Unknown] {
            assert_eq!(transparent_off_screen_sck_reason(placement).as_deref(), Some("off-screen"), "{placement:?}");
        }
    }
}
