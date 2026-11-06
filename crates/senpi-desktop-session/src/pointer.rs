//! Parsed pointer options and the per-target capture frame cache.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;

use senpi_desktop_core::backend::{DeliveryMode, Modifiers, MouseButton};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::keys::parse_modifiers;
use senpi_desktop_core::report::ReportMode;
use senpi_desktop_core::types::{PointerOptions, Target};

#[derive(Debug, Clone, Copy)]
pub(crate) struct ParsedPointerOptions {
    pub(crate) button: MouseButton,
    pub(crate) count: u32,
    pub(crate) modifiers: Modifiers,
    pub(crate) mode: DeliveryMode,
}

impl ParsedPointerOptions {
    pub(crate) fn parse(options: Option<&PointerOptions>) -> CoreResult<Self> {
        let default = PointerOptions::default();
        let options = options.unwrap_or(&default);
        Ok(Self {
            button: MouseButton::parse(options.button.as_deref())?,
            count: options.count.unwrap_or(1).max(1),
            modifiers: parse_modifiers(options.modifiers.as_deref().unwrap_or_default())?,
            mode: DeliveryMode::parse(options.delivery_mode.as_deref()),
        })
    }

    /// The delivery mode alone, known before the options are validated so
    /// the input transaction can capture what that mode disturbs.
    pub(crate) fn requested_mode(options: Option<&PointerOptions>) -> DeliveryMode {
        DeliveryMode::parse(options.and_then(|options| options.delivery_mode.as_deref()))
    }
}

#[derive(Clone)]
struct CapturedFrame {
    id: String,
    geometry: FrameGeometry,
}

/// Captures recorded by this engine process, across every session and
/// re-open: a frame id is never issued twice.
static CAPTURES: AtomicU64 = AtomicU64::new(0);

/// Tells this engine process's frame ids from another's.
fn engine_instance() -> &'static str {
    static INSTANCE: OnceLock<String> = OnceLock::new();
    INSTANCE.get_or_init(|| ulid::Ulid::generate().to_string().to_ascii_lowercase())
}

/// `frame-<engine instance>-<process-wide counter>`: a stale id from before
/// a session re-open, or from another engine, never equals a fresh one.
fn next_frame_id() -> String {
    let capture = CAPTURES.fetch_add(1, Ordering::Relaxed).saturating_add(1);
    format!("frame-{}-{capture}", engine_instance())
}

/// The latest capture of every target; coordinate input maps through it.
#[derive(Clone, Default)]
pub(crate) struct FrameCache {
    /// `reportMode` of the session that owns the cache: a `"null"` (v1)
    /// session keeps the v1 id shape `frame-<n>`, counted per open.
    report_mode: ReportMode,
    /// Captures this open recorded; the v1 id counter.
    captures: u64,
    latest: HashMap<String, CapturedFrame>,
}

impl FrameCache {
    /// An empty cache of a session opened with `report_mode`.
    pub(crate) fn with_report_mode(report_mode: ReportMode) -> Self {
        Self {
            report_mode,
            ..Self::default()
        }
    }

    /// Restores delivered frames without recycling an abandoned v1 frame id;
    /// object-mode ids are process-wide, so none is recycled there either.
    pub(crate) fn restore(&mut self, mut delivered: Self) {
        delivered.captures = delivered.captures.max(self.captures);
        *self = delivered;
    }

    /// Records a new capture of `target` and returns its frame id.
    pub(crate) fn record(&mut self, target: &Target, geometry: FrameGeometry) -> String {
        self.captures = self.captures.saturating_add(1);
        let id = match self.report_mode {
            ReportMode::Null => format!("frame-{}", self.captures),
            ReportMode::Object => next_frame_id(),
        };
        let frame = CapturedFrame {
            id: id.clone(),
            geometry,
        };
        self.latest.insert(target.key().to_owned(), frame);
        id
    }

    /// The id of the latest capture of the target keyed `target_key`.
    pub(crate) fn latest_id(&self, target_key: &str) -> Option<&str> {
        self.latest.get(target_key).map(|frame| frame.id.as_str())
    }

    /// The geometry of `target`'s latest capture; a named `frame_id` must be
    /// that capture.
    pub(crate) fn latest(&self, target: &Target, frame_id: Option<&str>) -> CoreResult<FrameGeometry> {
        let key = target.key();
        let frame = self.latest.get(key).ok_or_else(|| {
            DesktopError::invalid_coordinate_frame(format!(
                "no capture of '{key}' yet - take a screenshot of this target first; coordinate input is \
                 in pixels of that screenshot"
            ))
        })?;
        match frame_id {
            Some(requested) if requested != frame.id => Err(DesktopError::invalid_coordinate_frame(format!(
                "{requested} is not the latest capture of '{key}' ({}); capture it again before coordinate \
                 input",
                frame.id
            ))),
            Some(_) | None => Ok(frame.geometry.clone()),
        }
    }
}
