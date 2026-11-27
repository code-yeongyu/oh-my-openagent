//! The user-facing preview lane of row 21 on macOS (amendment A2): one stream per leased
//! window from the capture helper, cursor hidden, long edge `min(960, 2x points)`, JPEG under
//! 256 KiB, at most 2 frames per second, pushed only to subscribers and only while a lease is
//! active. Its frames are a separate type from model frames and never become one.

use std::collections::BTreeSet;

use super::helper::{FrameSource, HelperRequest};
use super::pixels::{decode_png, encode_jpeg, fit_long_edge};
use super::seam::CaptureHelper;
use super::types::CaptureFault;

pub const PREVIEW_LONG_EDGE: u32 = 960;
pub const PREVIEW_MAX_BYTES: usize = 256 * 1024;
pub const PREVIEW_MAX_FPS: u32 = 2;
/// JPEG quality, then the fallback quality when the first does not fit.
pub const PREVIEW_QUALITY: [u8; 2] = [60, 35];

const MIN_INTERVAL_MS: u64 = 1_000 / PREVIEW_MAX_FPS as u64;

/// The leased window and its long edge in points.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PreviewTarget {
    pub window: u32,
    pub points_long_edge: f64,
}

/// One preview frame and the connections it goes to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreviewPush {
    pub to: Vec<u64>,
    pub jpeg: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// The preview lane's state on the hand.
#[derive(Debug, Default)]
pub struct PreviewLane {
    subscribers: BTreeSet<u64>,
    lease: Option<PreviewTarget>,
    streaming: Option<u32>,
    last_push_ms: Option<u64>,
    next_id: u64,
}

impl PreviewLane {
    pub fn subscribe(&mut self, connection: u64) {
        self.subscribers.insert(connection);
    }

    pub fn unsubscribe(&mut self, connection: u64) {
        self.subscribers.remove(&connection);
    }

    /// The window the foreground lease holds; `None` when the lease ended.
    pub fn set_lease(&mut self, lease: Option<PreviewTarget>) {
        self.lease = lease;
    }

    /// Stops a stream nobody may see, then pushes the newest frame when one is due.
    ///
    /// # Errors
    /// The helper's fault; a reply that is not a stream frame is [`CaptureFault::Protocol`].
    pub fn tick(
        &mut self,
        now_ms: u64,
        helper: &mut dyn CaptureHelper,
    ) -> Result<Option<PreviewPush>, CaptureFault> {
        let wanted = self.lease.filter(|_| !self.subscribers.is_empty());
        if let Some(window) = self
            .streaming
            .filter(|w| Some(*w) != wanted.map(|t| t.window))
        {
            self.streaming = None;
            self.last_push_ms = None;
            let id = self.id();
            helper.call(&HelperRequest::StreamStop { id, window })?;
        }
        let Some(target) = wanted else {
            return Ok(None);
        };
        if self
            .last_push_ms
            .is_some_and(|last| now_ms.saturating_sub(last) < MIN_INTERVAL_MS)
        {
            return Ok(None);
        }
        let long_edge = long_edge(target.points_long_edge);
        if self.streaming.is_none() {
            let id = self.id();
            let start = HelperRequest::StreamStart {
                id,
                window: target.window,
                long_edge,
                fps: PREVIEW_MAX_FPS,
            };
            helper.call(&start)?;
            self.streaming = Some(target.window);
        }
        let id = self.id();
        let frame = helper.call(&HelperRequest::StreamFrame {
            id,
            window: target.window,
        })?;
        if frame.reply.source != Some(FrameSource::Stream) {
            return Err(CaptureFault::Protocol);
        }
        let image = fit_long_edge(&decode_png(&frame.png)?, long_edge);
        let Some(jpeg) = fitting_jpeg(&image)? else {
            return Ok(None);
        };
        self.last_push_ms = Some(now_ms);
        Ok(Some(PreviewPush {
            to: self.subscribers.iter().copied().collect(),
            jpeg,
            width: image.width(),
            height: image.height(),
        }))
    }

    fn id(&mut self) -> u64 {
        self.next_id += 1;
        self.next_id
    }
}

#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
fn long_edge(points: f64) -> u32 {
    let doubled = (points * 2.0).round();
    if doubled.is_nan() || doubled <= 1.0 {
        1
    } else if doubled >= f64::from(PREVIEW_LONG_EDGE) {
        PREVIEW_LONG_EDGE
    } else {
        doubled as u32
    }
}

fn fitting_jpeg(image: &image::RgbaImage) -> Result<Option<Vec<u8>>, CaptureFault> {
    for quality in PREVIEW_QUALITY {
        let jpeg = encode_jpeg(image, quality)?;
        if jpeg.len() <= PREVIEW_MAX_BYTES {
            return Ok(Some(jpeg));
        }
    }
    Ok(None)
}
