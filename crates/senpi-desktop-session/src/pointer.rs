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
use senpi_desktop_safety::FrameRefusal;

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
    /// This engine process's capture number; an epoch move supersedes every
    /// capture up to the one current then.
    seq: u64,
    geometry: FrameGeometry,
    /// Set once an action sent with `consume: true` delivered through this
    /// frame. It lives in the cache entry, so restoring a checkpoint taken
    /// after the consume keeps it.
    consumed: bool,
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
fn next_frame_id() -> (String, u64) {
    let capture = CAPTURES.fetch_add(1, Ordering::Relaxed).saturating_add(1);
    (format!("frame-{}-{capture}", engine_instance()), capture)
}

/// Targets whose latest capture the cache keeps (DESIGN 9, frame store);
/// capturing one more evicts the least recently captured target.
pub(crate) const MAX_TARGETS: usize = 16;

/// The latest capture of up to [`MAX_TARGETS`] targets; coordinate input maps
/// through it.
#[derive(Clone, Default)]
pub(crate) struct FrameCache {
    /// `reportMode` of the session that owns the cache: a `"null"` (v1)
    /// session keeps the v1 id shape `frame-<n>`, counted per open.
    report_mode: ReportMode,
    /// Captures this open recorded; the v1 id counter.
    captures: u64,
    latest: HashMap<String, CapturedFrame>,
    /// Captures numbered up to this one were taken before the last epoch move.
    superseded_through: u64,
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
    /// object-mode ids are process-wide, so none is recycled there either,
    /// and an epoch move since the checkpoint still supersedes them.
    pub(crate) fn restore(&mut self, mut delivered: Self) {
        delivered.captures = delivered.captures.max(self.captures);
        let superseded_through = self.superseded_through.max(delivered.superseded_through);
        *self = delivered;
        self.superseded_through = superseded_through;
    }

    /// The epoch moved: every capture taken so far is superseded, by name or
    /// as the target's latest.
    pub(crate) fn supersede_all(&mut self) {
        self.superseded_through = CAPTURES.load(Ordering::Relaxed);
    }

    fn superseded(&self, frame: &CapturedFrame) -> bool {
        frame.seq <= self.superseded_through
    }

    /// Records a new capture of `target` and returns its frame id.
    pub(crate) fn record(&mut self, target: &Target, geometry: FrameGeometry) -> String {
        self.captures = self.captures.saturating_add(1);
        let (object_id, seq) = next_frame_id();
        let id = match self.report_mode {
            ReportMode::Null => format!("frame-{}", self.captures),
            ReportMode::Object => object_id,
        };
        let frame = CapturedFrame {
            id: id.clone(),
            seq,
            geometry,
            consumed: false,
        };
        self.latest.insert(target.key().to_owned(), frame);
        if self.latest.len() > MAX_TARGETS {
            self.evict_oldest();
        }
        id
    }

    /// Drops the target captured longest ago; its frame id then answers as
    /// never captured.
    fn evict_oldest(&mut self) {
        let oldest = self
            .latest
            .iter()
            .min_by_key(|(_, frame)| frame.seq)
            .map(|(key, _)| key.clone());
        if let Some(key) = oldest {
            self.latest.remove(&key);
        }
    }

    /// The id of the latest capture of the target keyed `target_key`.
    pub(crate) fn latest_id(&self, target_key: &str) -> Option<&str> {
        self.latest.get(target_key).map(|frame| frame.id.as_str())
    }

    /// The geometry of the target's latest capture.
    pub(crate) fn latest_geometry(&self, target_key: &str) -> Option<&FrameGeometry> {
        self.latest.get(target_key).map(|frame| &frame.geometry)
    }

    /// Why the frame a request names (`frame_id`, else the target's latest)
    /// cannot take input, in the order the object-mode gate reports it.
    pub(crate) fn refusal(&self, target_key: &str, frame_id: Option<&str>) -> Option<FrameRefusal> {
        let latest = self.latest.get(target_key);
        let Some(requested) = frame_id else {
            return match latest {
                None => Some(FrameRefusal::FrameRequired),
                Some(frame) if self.superseded(frame) => Some(FrameRefusal::Superseded),
                Some(frame) if frame.consumed => Some(FrameRefusal::Consumed),
                Some(_) => None,
            };
        };
        let elsewhere = self
            .latest
            .iter()
            .any(|(key, frame)| key != target_key && frame.id == requested);
        match latest {
            _ if elsewhere => Some(FrameRefusal::WrongTarget),
            None => Some(FrameRefusal::NoCapture),
            Some(frame) if frame.id != requested || self.superseded(frame) => Some(FrameRefusal::Superseded),
            Some(frame) if frame.consumed => Some(FrameRefusal::Consumed),
            Some(_) => None,
        }
    }

    /// Whether the frame a request maps through was consumed: today's
    /// latest-capture check runs in a `reportMode: "null"` session, plus this.
    pub(crate) fn consumed(&self, target_key: &str, frame_id: Option<&str>) -> bool {
        self.latest
            .get(target_key)
            .is_some_and(|frame| frame.consumed && frame_id.is_none_or(|requested| requested == frame.id))
    }

    /// Marks the target's capture `frame_id` consumed; a later capture has
    /// already replaced it when the ids differ, so nothing is marked.
    pub(crate) fn consume(&mut self, target_key: &str, frame_id: &str) {
        if let Some(frame) = self.latest.get_mut(target_key).filter(|frame| frame.id == frame_id) {
            frame.consumed = true;
        }
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

#[cfg(test)]
mod tests {
    use senpi_desktop_core::frame::FrameGeometry;
    use senpi_desktop_core::types::Target;
    use senpi_desktop_safety::FrameRefusal;

    use super::{FrameCache, MAX_TARGETS};

    fn window(index: usize) -> Target {
        Target::Window(format!("{index}"))
    }

    #[test]
    fn capturing_a_seventeenth_target_evicts_the_least_recently_captured_one() {
        // Given: 16 targets captured, target 0 recaptured last
        let mut frames = FrameCache::default();
        let first: Vec<String> = (0..MAX_TARGETS)
            .map(|index| frames.record(&window(index), FrameGeometry::identity_global()))
            .collect();
        let recaptured = frames.record(&window(0), FrameGeometry::identity_global());
        // When
        let newest = frames.record(&window(MAX_TARGETS), FrameGeometry::identity_global());
        // Then: target 1 (oldest capture) is gone, every other target keeps its latest
        assert_eq!(frames.latest_id("1"), None);
        assert_eq!(frames.refusal("1", Some(&first[1])), Some(FrameRefusal::NoCapture));
        assert_eq!(frames.latest_id("0"), Some(recaptured.as_str()));
        assert_eq!(frames.latest_id(&MAX_TARGETS.to_string()), Some(newest.as_str()));
        for (index, id) in first.iter().enumerate().skip(2) {
            assert_eq!(frames.latest_id(&index.to_string()), Some(id.as_str()), "target {index}");
        }
    }

    #[test]
    fn recapturing_a_known_target_never_evicts() {
        // Given
        let mut frames = FrameCache::default();
        for index in 0..MAX_TARGETS {
            frames.record(&window(index), FrameGeometry::identity_global());
        }
        // When
        for _ in 0..MAX_TARGETS {
            frames.record(&window(3), FrameGeometry::identity_global());
        }
        // Then
        assert!((0..MAX_TARGETS).all(|index| frames.latest_id(&index.to_string()).is_some()));
    }
}
