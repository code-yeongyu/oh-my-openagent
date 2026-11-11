//! Readers of the read-tier params: each turns its params into the `ReadRequest` the
//! observation stages consume.

use super::options::{
    read_caps, read_observe_ax, read_point, read_rect, read_settle, At, AxSpec, ObserveSpec,
    Region, ScaleCaps,
};
use super::wait::{read_wait_predicate, WaitSpec};
use crate::listing::SurfaceKind;
use crate::params::{
    AxRefParams, AxTargetParams, CaptureParams, DrillParams, ElementAtParams, MenuItemsParams,
    ObserveParams, SurfaceParams, WaitForParams, WindowsParams, ZoomParams,
};

/// What a read method asks the observation stages for.
#[derive(Debug, Clone, PartialEq)]
pub enum ReadRequest {
    Windows {
        app: Option<String>,
        title: Option<String>,
        pid: Option<u32>,
    },
    Capture {
        target: String,
        /// `None` = not given; `Some(None)` = explicitly `null` (no caps).
        caps: Option<Option<ScaleCaps>>,
        exclude_window_titles: Vec<String>,
        crosshair: Option<At>,
        cursor: bool,
    },
    Zoom {
        target: String,
        region: Region,
    },
    Observe {
        target: String,
        caps: Option<ScaleCaps>,
        ax: Option<AxSpec>,
        spec: ObserveSpec,
    },
    AxSnapshot {
        target: String,
    },
    Drill {
        reference: String,
        depth: Option<u32>,
    },
    Element {
        reference: String,
    },
    ElementAt {
        target: String,
        at: At,
        frame_id: Option<String>,
    },
    WaitFor {
        target: String,
        predicate: WaitSpec,
        timeout_ms: Option<u64>,
    },
    MenuItems {
        target: String,
        path: Vec<String>,
    },
    Surface {
        kind: SurfaceKind,
        index: u32,
    },
}

#[must_use]
pub fn read_windows(params: WindowsParams) -> ReadRequest {
    let WindowsParams { app, title, pid } = params;
    ReadRequest::Windows { app, title, pid }
}

#[must_use]
pub fn read_capture(params: CaptureParams) -> ReadRequest {
    let CaptureParams {
        target,
        caps,
        exclude_window_titles,
        crosshair,
        cursor,
    } = params;
    ReadRequest::Capture {
        target,
        caps: caps.map(|given| given.map(read_caps)),
        exclude_window_titles: exclude_window_titles.unwrap_or_default(),
        crosshair: crosshair.map(read_point),
        cursor: cursor.unwrap_or(true),
    }
}

#[must_use]
pub fn read_zoom(params: ZoomParams) -> ReadRequest {
    let ZoomParams { target, region } = params;
    ReadRequest::Zoom {
        target,
        region: read_rect(region),
    }
}

#[must_use]
pub fn read_observe(params: ObserveParams) -> ReadRequest {
    let ObserveParams {
        target,
        caps,
        ax,
        screenshot,
        query,
        since,
        depth,
        skeleton,
        actions,
        settle,
        ocr,
    } = params;
    let spec = ObserveSpec {
        screenshot,
        ax: None,
        query,
        since,
        depth,
        skeleton,
        actions,
        settle: settle.map(read_settle),
        ocr,
    };
    ReadRequest::Observe {
        target,
        caps: caps.map(read_caps),
        ax: ax.map(read_observe_ax),
        spec,
    }
}

#[must_use]
pub fn read_ax_target(params: AxTargetParams) -> ReadRequest {
    let AxTargetParams { target } = params;
    ReadRequest::AxSnapshot { target }
}

#[must_use]
pub fn read_drill(params: DrillParams) -> ReadRequest {
    let DrillParams { reference, depth } = params;
    ReadRequest::Drill { reference, depth }
}

/// `ax.node`, `ax.children` and the v1 `ax.focus` name one element by ref.
#[must_use]
pub fn read_ax_ref(params: AxRefParams) -> ReadRequest {
    let AxRefParams { reference } = params;
    ReadRequest::Element { reference }
}

#[must_use]
pub fn read_element_at(params: ElementAtParams) -> ReadRequest {
    let ElementAtParams {
        target,
        x,
        y,
        frame_id,
    } = params;
    ReadRequest::ElementAt {
        target,
        at: At { x, y },
        frame_id,
    }
}

#[must_use]
pub fn read_wait_for(params: WaitForParams) -> ReadRequest {
    let WaitForParams {
        target,
        predicate,
        timeout,
    } = params;
    ReadRequest::WaitFor {
        target,
        predicate: read_wait_predicate(predicate),
        timeout_ms: timeout,
    }
}

#[must_use]
pub fn read_menu_items(params: MenuItemsParams) -> ReadRequest {
    let MenuItemsParams { target, path } = params;
    ReadRequest::MenuItems {
        target,
        path: path.unwrap_or_default(),
    }
}

#[must_use]
pub fn read_surface(params: SurfaceParams) -> ReadRequest {
    let SurfaceParams { kind, index } = params;
    ReadRequest::Surface {
        kind,
        index: index.unwrap_or(0),
    }
}
