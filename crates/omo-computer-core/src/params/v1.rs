//! Params of the v1 methods the corpus replays, with the members the contract adds to them.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::common::{Button, CaptureCaps, Delivery, OcrMode, Point, RequestId, SettleOptions};
use crate::settings::{Intervention, Settings, Trace};

/// `reportMode`: `"null"` keeps every v1 reply byte-identical; `"object"` opts into reports.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum ReportMode {
    Null,
    Object,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum OnOff {
    On,
    Off,
}

params! {
    /// `session.open`: the v1 session keys plus the `computer.*` settings table.
    SessionOpenParams {
        ;
        report_mode: ReportMode,
        intervention: Intervention,
        macos_key_priming: OnOff,
        trace: Trace,
        show_cursor: bool,
        allow_host_relay_only_stop: bool,
        settings: Settings,
    }
}

params! {
    CaptureParams {
        target: String;
        #[serde(with = "crate::nullable")]
        #[schemars(with = "Option<CaptureCaps>")]
        caps: Option<CaptureCaps>,
        exclude_window_titles: Vec<String>,
        /// Draws a crosshair at this point in the space `click` consumes (acceptance 90).
        crosshair: Point,
        /// `false` asks for a pointer-free frame (`Frame.cursor:"none"`).
        cursor: bool,
    }
}

/// v1 `observe.ax`: a node budget; the object mode's `ax` flag is the boolean.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(untagged)]
pub enum ObserveAx {
    Enabled(bool),
    Budget {
        #[serde(rename = "maxNodes")]
        max_nodes: u32,
    },
}

params! {
    ObserveParams {
        target: String;
        caps: CaptureCaps,
        ax: ObserveAx,
        screenshot: bool,
        query: String,
        since: u64,
        depth: u32,
        skeleton: bool,
        actions: bool,
        settle: SettleOptions,
        ocr: OcrMode,
    }
}

exec_params! {
    /// `click`: a point (v1) or a ref; `consume` asks for a consumption receipt.
    ClickParams {
        ;
        target: String,
        x: f64,
        y: f64,
        #[serde(rename = "ref")]
        reference: String,
        frame_id: String,
        button: Button,
        count: u8,
        modifiers: Vec<String>,
        delivery: Delivery,
        consume: bool,
        force: bool,
    }
}

params! { TypeTextParams { target: String, text: String; } }
params! { KeyChordParams { target: String, keys: Vec<String>; } }
params! { HoldKeysParams { target: String, keys: Vec<String>, duration: u64; } }
params! { HoldMouseParams { target: String, x: f64, y: f64, duration: u64; } }
params! { RaiseWindowParams { window_id: String; } }
params! { AxTargetParams { target: String; } }
params! { AxRefParams { #[serde(rename = "ref")] reference: String; } }
params! { AxPerformParams { #[serde(rename = "ref")] reference: String, action: String; } }
exec_params! { AxSetValueParams { #[serde(rename = "ref")] reference: String, value: String; } }
params! { AxTypeTextParams { #[serde(rename = "ref")] reference: String, text: String; } }
params! { ControlGrantParams { reason: String; confirmation_id: String, } }
params! { StopPathStartParams { ; chord: String, } }
params! { StopPathStopParams { ; source: String, } }
params! { StopPathResumeParams { token: String; } }
params! { CancelParams { id: RequestId; } }
params! { AdvanceClockParams { ms: u64; } }
