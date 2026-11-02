//! B9 routing between the persistent ScreenCaptureKit worker (macOS 14+) and
//! the legacy `screencapture` path, with once-per-reason fallback logging.

use std::sync::atomic::{AtomicU8, Ordering};

use image::RgbaImage;
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::types::{DesktopDisplay, DesktopWindow, Target};

use super::sck::{SckCaptureError, SckFrame, SckUnavailable, SckWorker};
use super::{parse_window_id, MacCapture};

/// Start failures log once until SCK recovers; availability reasons log once
/// per engine process. Bits also record the `legacyCapture` capability.
const REASON_UNSUPPORTED: u8 = 1;
const REASON_HELPER_MISSING: u8 = 2;
const REASON_START_FAILED: u8 = 4;
const REASON_TIMED_OUT: u8 = 8;
#[cfg(not(test))]
static LEGACY_REASONS: AtomicU8 = AtomicU8::new(0);

fn with_legacy_reasons<T>(action: impl FnOnce(&AtomicU8) -> T) -> T {
    #[cfg(test)]
    {
        test_support::LEGACY_REASONS.with(action)
    }
    #[cfg(not(test))]
    {
        action(&LEGACY_REASONS)
    }
}

fn note_legacy(reason: u8, log_line: &str) {
    with_legacy_reasons(|store| {
        note_legacy_into(store, reason, log_line, |line| {
            eprintln!("senpi-desktop-backend-macos: capture: {line}");
        });
    });
}

fn note_legacy_into(store: &AtomicU8, reason: u8, log_line: &str, log: impl FnOnce(&str)) {
    let prior = store.fetch_or(reason, Ordering::Relaxed);
    if prior & reason == 0 {
        log(log_line);
    }
}

fn note_timed_out(error: &DesktopError) {
    note_legacy(
        REASON_TIMED_OUT,
        &format!(
            "the ScreenCaptureKit capture helper exceeded its capture budget: {error}; \
             it restarts for the next capture and this one uses the screencapture fallback"
        ),
    );
}

fn note_start_failure(error: &DesktopError) {
    note_legacy(
        REASON_START_FAILED,
        &format!(
            "the ScreenCaptureKit capture helper failed to start: {error}; \
             using the screencapture fallback"
        ),
    );
}

/// Whether a legacy fallback already ran (or a helper start already failed).
fn legacy_capture_active() -> bool {
    with_legacy_reasons(|store| store.load(Ordering::Relaxed) != 0)
}

/// The availability the router honors; tests override it.
fn sck_availability() -> Result<(), SckUnavailable> {
    #[cfg(test)]
    if let Some(value) = test_support::AVAILABILITY.with(std::cell::Cell::get) {
        return value;
    }
    SckWorker::availability()
}

impl MacCapture {
    /// Whether captures run through the legacy `screencapture` path: the SCK
    /// worker is unavailable on this host, or a helper start already failed.
    pub(crate) fn legacy_capture(&self) -> bool {
        !matches!(sck_availability(), Ok(())) || legacy_capture_active()
    }

    /// A capture whose display targets may exclude titled windows (B9 SCK).
    ///
    /// The legacy `screencapture` path runs with no error in these fallback
    /// cases (lead ruling 2026-10-12): macOS < 14, a missing helper, a helper
    /// that fails its warm-up ping before the lock (it cannot spawn, exits, or
    /// stalls; a stall keeps the worker off for 30 s), and a warm helper that
    /// exceeds its in-lock budget (it is reset and restarts next time). Each
    /// logs once per reason and reports `legacyCapture: true` on the result.
    /// A warm helper that dies mid-capture surfaces the error and resets.
    ///
    /// Every route runs inside the cursor-overlay guard, and the visible
    /// cursor-helper windows it reports are excluded by window ID.
    pub(crate) fn capture_with_exclusions(
        &self,
        target: &Target,
        exclude_window_titles: &[String],
    ) -> CoreResult<(RgbaImage, FrameGeometry)> {
        self.require_permission()?;
        // Warm the helper before the lock: a cold or stalled start must not
        // hold the cursor-exclusion lock that other captures wait on.
        let sck_ready = match sck_availability() {
            Ok(()) => match SckWorker::prepare() {
                Ok(()) => true,
                Err(error) => {
                    note_start_failure(&error);
                    false
                },
            },
            Err(_) => false,
        };
        let routed = self.with_overlay_exclusion(|excluded| {
            self.route_capture(target, exclude_window_titles, excluded, sck_ready)
        })?;
        match routed {
            Some(captured) => Ok(captured),
            // The fallback takes its own lock hold, so one capture never holds
            // the lock for an SCK budget plus a legacy capture. Worst case for
            // one capture, every bound hit: 5 s warm-up + 8 s lock wait + 6 s
            // SCK + 8 s lock wait + 5 s filtered legacy = 32 s; a timeout then
            // keeps SCK off for 30 s, so the next captures skip the first three.
            None => self.with_overlay_exclusion(|excluded| self.capture_via_legacy(target, excluded)),
        }
    }

    fn route_capture(
        &self,
        target: &Target,
        exclude_window_titles: &[String],
        excluded: &[u32],
        sck_ready: bool,
    ) -> CoreResult<Option<(RgbaImage, FrameGeometry)>> {
        match sck_availability() {
            // The warm-up failed and was noted; skip the worker inside the lock.
            Ok(()) if !sck_ready => self.capture_via_legacy(target, excluded).map(Some),
            Ok(()) => match self.capture_via_sck(target, exclude_window_titles, excluded)? {
                Some(captured) => {
                    if !captured.1.is_legacy_capture() {
                        // Recovery lets a later start failure log its reason again.
                        with_legacy_reasons(|store| {
                            store.fetch_and(!(REASON_START_FAILED | REASON_TIMED_OUT), Ordering::Relaxed);
                        });
                    }
                    Ok(Some(captured))
                },
                // Start failure or in-lock timeout: fall back in a new lock hold.
                None => Ok(None),
            },
            Err(SckUnavailable::Unsupported) => {
                note_legacy(
                    REASON_UNSUPPORTED,
                    "ScreenCaptureKit requires macOS 14; using the screencapture fallback",
                );
                self.capture_via_legacy(target, excluded).map(Some)
            },
            Err(SckUnavailable::HelperUnavailable) => {
                note_legacy(
                    REASON_HELPER_MISSING,
                    "no ScreenCaptureKit capture helper is staged; \
                     using the screencapture fallback",
                );
                self.capture_via_legacy(target, excluded).map(Some)
            },
        }
    }

    /// The SCK route. `Ok(None)` when the helper failed to start or a warm
    /// helper exceeded its in-lock budget (the caller falls back silently, in
    /// a new lock hold); reply errors and mid-capture transport
    /// deaths surface as errors (the worker resets after a death).
    fn capture_via_sck(
        &self,
        target: &Target,
        exclude_window_titles: &[String],
        excluded: &[u32],
    ) -> CoreResult<Option<(RgbaImage, FrameGeometry)>> {
        match target {
            Target::Window(id) => {
                let window_id = parse_window_id(id)?;
                if excluded.contains(&window_id) {
                    return Err(DesktopError::capture_failed("cursor-helper windows are not capture targets"));
                }
                let request = super::sck::target_window(window_id);
                let frames = match SckWorker::capture(std::slice::from_ref(&request)) {
                    Ok(frames) => frames,
                    Err(SckCaptureError::Start(error)) => {
                        note_start_failure(&error);
                        return Ok(None);
                    },
                    Err(SckCaptureError::TimedOut(error)) => {
                        note_timed_out(&error);
                        return Ok(None);
                    },
                    Err(SckCaptureError::Failed(error)) => return Err(error),
                };
                let [frame] = <[SckFrame; 1]>::try_from(frames).map_err(|_| {
                    DesktopError::capture_failed(
                        "capture worker returned a batch for a single window request",
                    )
                })?;
                if frame.is_on_screen == Some(false)
                    && frame
                        .pid
                        .and_then(|pid| super::minimized::window_minimized(pid, window_id))
                        == Some(true)
                {
                    return Err(DesktopError::capture_unavailable(
                        "minimized",
                        format!(
                            "window '{id}' is minimized; restore it, \
                             or read it through accessibility"
                        ),
                    ));
                }
                let (width, height) = (frame.image.width(), frame.image.height());
                let (x, y, logical_width, logical_height) = frame.bounds;
                let window = DesktopWindow {
                    id: id.clone(),
                    title: String::new(),
                    app: String::new(),
                    pid: None,
                    x: x.round() as i32,
                    y: y.round() as i32,
                    width: logical_width.round() as u32,
                    height: logical_height.round() as u32,
                    focused: false,
                    is_on_screen: frame.is_on_screen,
                    elevated: None,
                };
                let geometry = FrameGeometry::for_window(&window, width, height);
                Ok(Some((frame.into_image(), geometry)))
            },
            Target::Desktop | Target::Display(_) => {
                let selector = target.display_selector().unwrap_or_else(|| self.selector.clone());
                let displays = self.displays_for(&selector)?;
                let requests: Vec<_> = displays
                    .iter()
                    .filter_map(|display| {
                        display
                            .id
                            .parse::<u32>()
                            .ok()
                            .map(|id| super::sck::target_display(id, exclude_window_titles, excluded))
                    })
                    .collect();
                if requests.len() != displays.len() {
                    return self
                        .capture_desktop(&selector, excluded)
                        .map(|(image, geometry)| Some((image, geometry.into_legacy_capture())));
                }
                match SckWorker::capture(&requests) {
                    Ok(frames) => composite_sck(&displays, frames).map(Some),
                    Err(SckCaptureError::Start(error)) => {
                        note_start_failure(&error);
                        Ok(None)
                    },
                    Err(SckCaptureError::TimedOut(error)) => {
                        note_timed_out(&error);
                        Ok(None)
                    },
                    Err(SckCaptureError::Failed(error)) => Err(error),
                }
            },
        }
    }

    /// The pre-B9 route: `screencapture` per shot, marked `legacyCapture`.
    /// Visible cursor helpers are excluded through the filtered capture path.
    fn capture_via_legacy(&self, target: &Target, excluded: &[u32]) -> CoreResult<(RgbaImage, FrameGeometry)> {
        let (image, geometry) = match target {
            Target::Window(id) => self.capture_window(id, excluded)?,
            Target::Desktop | Target::Display(_) => {
                let selector = target.display_selector().unwrap_or_else(|| self.selector.clone());
                self.capture_desktop(&selector, excluded)?
            },
        };
        Ok((image, geometry.into_legacy_capture()))
    }
}

/// Pairs SCK display frames with their displays and composites them.
fn composite_sck(
    displays: &[DesktopDisplay],
    frames: Vec<SckFrame>,
) -> CoreResult<(RgbaImage, FrameGeometry)> {
    if frames.len() != displays.len() {
        return Err(DesktopError::capture_failed(
            "capture worker returned a partial display batch",
        ));
    }
    let regions = displays
        .iter()
        .cloned()
        .zip(frames.into_iter().map(|frame| frame.into_image()))
        .collect();
    super::displays::composite(regions)
}

#[cfg(test)]
pub(crate) mod test_support;

#[cfg(test)]
mod tests;
#[cfg(test)]
mod start_tests;
