//! The capture helper's wire. A request is one JSON line; a reply is one JSON line followed
//! by exactly `pngBytes` raw PNG bytes when it carries a frame. Model-bound stills and the
//! preview stream are different operations, and a reply names which one made its frame.

use serde::{Deserialize, Serialize};

/// One request to the persistent capture helper.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum HelperRequest {
    /// A model-bound still through `SCScreenshotManager`; never a stream frame.
    Screenshot {
        id: u64,
        target: ShotTarget,
        cursor: bool,
        exclude: Vec<u32>,
    },
    /// Starts the preview stream of one leased window (cursor hidden).
    #[serde(rename_all = "camelCase")]
    StreamStart {
        id: u64,
        window: u32,
        long_edge: u32,
        fps: u32,
    },
    /// The newest frame of a running preview stream.
    StreamFrame {
        id: u64,
        window: u32,
    },
    StreamStop {
        id: u64,
        window: u32,
    },
    /// `computer.record`: the stream feeds an H.264 file at no more than [`RECORD_MAX_FPS`].
    RecordStart {
        id: u64,
        path: String,
        fps: u32,
    },
    RecordStop {
        id: u64,
    },
}

/// Frames per second the recording stream never exceeds (design row K13's macOS stream).
pub const RECORD_MAX_FPS: u32 = 15;

impl HelperRequest {
    #[must_use]
    pub const fn id(&self) -> u64 {
        match self {
            Self::Screenshot { id, .. }
            | Self::StreamStart { id, .. }
            | Self::StreamFrame { id, .. }
            | Self::StreamStop { id, .. }
            | Self::RecordStart { id, .. }
            | Self::RecordStop { id } => *id,
        }
    }

    /// A recording start clamped to [`RECORD_MAX_FPS`].
    #[must_use]
    pub fn record_start(id: u64, path: String, fps: u32) -> Self {
        Self::RecordStart {
            id,
            path,
            fps: fps.clamp(1, RECORD_MAX_FPS),
        }
    }
}

/// What a still captures: one window through the desktop-independent window filter, or a
/// display with the excluded windows removed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ShotTarget {
    Window { window: u32 },
    Display { display: u32 },
}

/// Which operation produced a frame.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FrameSource {
    Screenshot,
    Stream,
}

/// The content filter the helper applied to a still.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FilterKind {
    /// `SCContentFilter(desktopIndependentWindow:)`: the target window's own pixels only.
    Window,
    /// `SCContentFilter(display:excludingWindows:)`.
    Display,
}

/// Why the helper produced no frame.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HelperError {
    Denied,
    Timeout,
    NullFrame,
    NotFound,
}

/// One reply line.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HelperReply {
    pub id: u64,
    pub ok: bool,
    #[serde(default)]
    pub error: Option<HelperError>,
    #[serde(default)]
    pub source: Option<FrameSource>,
    #[serde(default)]
    pub filter: Option<FilterKind>,
    /// The window numbers the helper removed from a display still.
    #[serde(default)]
    pub excluded: Vec<u32>,
    #[serde(default)]
    pub png_bytes: usize,
}

/// A reply and the frame bytes that followed it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HelperFrame {
    pub reply: HelperReply,
    pub png: Vec<u8>,
}
