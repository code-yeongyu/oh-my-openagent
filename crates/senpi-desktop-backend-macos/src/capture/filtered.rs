//! Native per-frame exclusion. Never falls back to unfiltered pixels.
use block2::RcBlock;
use image::RgbaImage;
use objc2::{msg_send, sel, AnyThread};
use objc2::runtime::AnyClass;
use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep};
use objc2_core_graphics::CGImage;
use objc2_foundation::{NSArray, NSDictionary, NSError};
use objc2_screen_capture_kit::{
    SCContentFilter, SCShareableContent, SCScreenshotManager, SCStreamConfiguration, SCWindow,
};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use std::sync::mpsc;
use std::time::Duration;

fn error(error: *mut NSError) -> Option<DesktopError> {
    // SAFETY: ScreenCaptureKit supplies a nullable NSError valid for this callback.
    unsafe { error.as_ref() }.map(|e| DesktopError::capture_failed(e.localizedDescription().to_string()))
}

fn pixels(image: *mut CGImage) -> CoreResult<RgbaImage> {
    // SAFETY: The callback's image is borrowed only until its pixels have been copied.
    let image = unsafe { image.as_ref() }
        .ok_or_else(|| DesktopError::capture_failed("filtered capture returned no image"))?;
    let bitmap = NSBitmapImageRep::initWithCGImage(NSBitmapImageRep::alloc(), image);
    // SAFETY: An empty properties dictionary has no incorrectly typed values; bitmap owns the image.
    let png = unsafe {
        bitmap.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new())
    }.ok_or_else(|| DesktopError::capture_failed("cannot encode filtered capture"))?;
    image::load_from_memory(&png.to_vec())
        .map(|image| image.to_rgba8())
        .map_err(|e| DesktopError::capture_failed(format!("cannot decode filtered capture: {e}")))
}

/// Whether this OS offers per-frame window exclusion (`SCScreenshotManager`, macOS 14+).
pub(crate) fn supported() -> bool {
    let Some(manager) = AnyClass::get(c"SCScreenshotManager") else {
        return false;
    };
    // SAFETY: NSObject class introspection accepts this selector and has no side effects.
    unsafe {
        msg_send![manager, respondsToSelector: sel!(captureImageWithFilter:configuration:completionHandler:)]
    }
}

/// Exclusion IDs present in the content snapshot. A helper missing from the snapshot is dropped
/// only when the window list confirms it no longer exists (it has no pixels left to hide); one
/// that still exists but cannot be excluded fails the frame, so it is never captured unfiltered.
pub(super) fn resolve_exclusions(
    excluded: &[u32],
    in_content: impl Fn(u32) -> bool,
    alive: impl FnOnce() -> CoreResult<Vec<u32>>,
) -> CoreResult<Vec<u32>> {
    let (present, missing): (Vec<u32>, Vec<u32>) = excluded.iter().copied().partition(|id| in_content(*id));
    if missing.is_empty() {
        return Ok(present);
    }
    let alive = alive()?;
    if let Some(id) = missing.iter().find(|id| alive.contains(id)) {
        return Err(DesktopError::capture_failed(format!(
            "cursor helper window {id} exists but is absent from the capture content; refusing an unfiltered frame"
        )));
    }
    Ok(present)
}

pub(super) fn capture(
    display: Option<u32>,
    window: Option<u32>,
    width: u32,
    height: u32,
    excluded_ids: &[u32],
) -> CoreResult<RgbaImage> {
    if !supported() {
        return Err(DesktopError::capture_failed("filtered screenshots require macOS 14 or later"));
    }
    let excluded_ids = excluded_ids.to_vec();
    let (send, receive) = mpsc::channel();
    let completion = RcBlock::new(move |content: *mut SCShareableContent, failure: *mut NSError| {
        let start = || -> CoreResult<()> {
            if let Some(error) = error(failure) { return Err(error); }
            // SAFETY: Content is borrowed only during the completion; native objects stay on this thread.
            let content = unsafe { content.as_ref() }
                .ok_or_else(|| DesktopError::capture_failed("cannot enumerate filtered capture content"))?;
            // SAFETY: These getters return immutable arrays retained for this scope.
            let windows = unsafe { content.windows() };
            // SAFETY: Every entry is a live SCWindow from SCShareableContent.
            let present = resolve_exclusions(
                &excluded_ids,
                |id| windows.iter().any(|w| unsafe { w.windowID() } == id),
                || crate::focus::window_info().map(|all| all.into_iter().map(|w| w.window_number).collect()),
            )?;
            // SAFETY: Every entry is a live SCWindow from SCShareableContent.
            let excluded: Vec<_> = windows.iter().filter(|w| present.contains(&unsafe { w.windowID() })).collect();
            let filter = if let Some(id) = window {
                // SAFETY: Every entry is a live SCWindow from SCShareableContent.
                let target = windows.iter().find(|w| unsafe { w.windowID() } == id)
                    .ok_or_else(|| DesktopError::capture_failed("filtered target window is unavailable"))?;
                // SAFETY: The window and allocated filter are valid native objects.
                unsafe { SCContentFilter::initWithDesktopIndependentWindow(SCContentFilter::alloc(), &target) }
            } else {
                // SAFETY: Getter returns immutable retained SCDisplay entries.
                let displays = unsafe { content.displays() };
                let target = displays.iter().find(|d| Some(unsafe { d.displayID() }) == display)
                    .ok_or_else(|| DesktopError::capture_failed("filtered target display is unavailable"))?;
                let excluded: objc2::rc::Retained<NSArray<SCWindow>> = NSArray::from_retained_slice(&excluded);
                // SAFETY: All excluded windows and the display came from this content snapshot.
                unsafe { SCContentFilter::initWithDisplay_excludingWindows(SCContentFilter::alloc(), &target, &excluded) }
            };
            // SAFETY: Configuration is newly owned; the window filter supplies its native point/pixel scale.
            let config = unsafe {
                let config = SCStreamConfiguration::new();
                if window.is_some() {
                    let rect = filter.contentRect();
                    let scale = f64::from(filter.pointPixelScale());
                    config.setWidth((rect.size.width * scale).ceil() as usize);
                    config.setHeight((rect.size.height * scale).ceil() as usize);
                } else {
                    config.setWidth(width as usize);
                    config.setHeight(height as usize);
                }
                config.setShowsCursor(false);
                config
            };
            let finished = send.clone();
            let image_ready = RcBlock::new(move |image: *mut CGImage, failure: *mut NSError| {
                let result = match error(failure) {
                    Some(error) => Err(error),
                    None => pixels(image),
                };
                if let Err(error) = finished.send(result) {
                    eprintln!("filtered capture completed after its waiter exited: {error}");
                }
            });
            // SAFETY: Native API copies its completion block; no native pointer escapes the callback.
            unsafe {
                SCScreenshotManager::captureImageWithFilter_configuration_completionHandler(
                    &filter, &config, Some(&image_ready),
                );
            }
            Ok(())
        };
        if let Err(error) = start() {
            if let Err(error) = send.send(Err(error)) {
                eprintln!("filtered capture setup completed after its waiter exited: {error}");
            }
        }
    });
    // SAFETY: Native API copies the completion block; all content access stays within it.
    unsafe {
        SCShareableContent::getShareableContentExcludingDesktopWindows_onScreenWindowsOnly_completionHandler(
            false, false, &completion,
        );
    }
    receive.recv_timeout(Duration::from_secs(5))
        .map_err(|e| DesktopError::capture_failed(format!("filtered capture did not complete: {e}")))?
}

#[cfg(test)]
#[path = "filtered_tests.rs"]
mod tests;
