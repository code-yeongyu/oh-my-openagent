//! Readers of the option objects several params carry. Each destructures its input with
//! every field named (no `..`), so a new field does not compile until a reader takes it.

use crate::listing::Rect;
use crate::params::{
    CaptureCaps, ObserveAx, ObserveOptions, ObserveRequest, OcrMode, Point, SettleOptions,
    TextRange,
};

/// A point in the space of the frame the call names.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct At {
    pub x: f64,
    pub y: f64,
}

/// A region in the space of the frame the call names.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Region {
    pub origin: At,
    pub width: f64,
    pub height: f64,
}

/// The settle wait an observe or `waitFor` runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct SettleSpec {
    pub quiet_ms: Option<u64>,
    pub timeout_ms: Option<u64>,
}

/// What an observation reads and renders.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ObserveSpec {
    pub screenshot: Option<bool>,
    pub ax: Option<bool>,
    pub query: Option<String>,
    pub since: Option<u64>,
    pub depth: Option<u32>,
    pub skeleton: Option<bool>,
    pub actions: Option<bool>,
    pub settle: Option<SettleSpec>,
    pub ocr: Option<OcrMode>,
}

/// The v1 frame-scaling caps.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ScaleCaps {
    pub max_width: Option<u32>,
    pub max_height: Option<u32>,
    pub max_bytes: Option<u64>,
}

/// The v1 accessibility switch of `observe`: on/off or a node budget.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AxSpec {
    Enabled(bool),
    NodeBudget(u32),
}

/// The text a selection covers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TextSpan {
    Range { start: u32, end: u32 },
    Matching(String),
}

#[must_use]
pub fn read_point(point: Point) -> At {
    let Point { x, y } = point;
    At { x, y }
}

#[must_use]
pub fn read_rect(rect: Rect) -> Region {
    let Rect {
        x,
        y,
        width,
        height,
    } = rect;
    Region {
        origin: At { x, y },
        width,
        height,
    }
}

#[must_use]
pub fn read_settle(settle: SettleOptions) -> SettleSpec {
    let SettleOptions {
        quiet_ms,
        timeout_ms,
    } = settle;
    SettleSpec {
        quiet_ms,
        timeout_ms,
    }
}

#[must_use]
pub fn read_observe_options(options: ObserveOptions) -> ObserveSpec {
    let ObserveOptions {
        screenshot,
        ax,
        query,
        since,
        depth,
        skeleton,
        actions,
        settle,
        ocr,
    } = options;
    ObserveSpec {
        screenshot,
        ax,
        query,
        since,
        depth,
        skeleton,
        actions,
        settle: settle.map(read_settle),
        ocr,
    }
}

#[must_use]
pub fn read_caps(caps: CaptureCaps) -> ScaleCaps {
    let CaptureCaps {
        max_width,
        max_height,
        max_bytes,
    } = caps;
    ScaleCaps {
        max_width,
        max_height,
        max_bytes,
    }
}

#[must_use]
pub fn read_observe_ax(ax: ObserveAx) -> AxSpec {
    match ax {
        ObserveAx::Enabled(enabled) => AxSpec::Enabled(enabled),
        ObserveAx::Budget { max_nodes } => AxSpec::NodeBudget(max_nodes),
    }
}

/// `apps.open{observe}`: `true` takes the default observation, `false` none.
#[must_use]
pub fn read_observe_request(request: ObserveRequest) -> Option<ObserveSpec> {
    match request {
        ObserveRequest::Defaults(wanted) => wanted.then(ObserveSpec::default),
        ObserveRequest::Options(options) => Some(read_observe_options(options)),
    }
}

#[must_use]
pub fn read_text_range(range: TextRange) -> TextSpan {
    match range {
        TextRange::Span { start, end } => TextSpan::Range { start, end },
        TextRange::Text { text } => TextSpan::Matching(text),
    }
}
