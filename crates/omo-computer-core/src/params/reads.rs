//! Params of the read-tier methods the model-facing surface adds.

use crate::listing::{Rect, SurfaceKind};

params! {
    /// `windows`: an optional filter; `{}` lists every window.
    WindowsParams { ; app: String, title: String, pid: u32, }
}

params! { DrillParams { #[serde(rename = "ref")] reference: String; depth: u32, } }
params! { ZoomParams { target: String, region: Rect; } }
params! { ElementAtParams { target: String, x: f64, y: f64; frame_id: String, } }
params! { MenuItemsParams { target: String; path: Vec<String>, } }
params! { SurfaceParams { kind: SurfaceKind; index: u32, } }
params! { OpenSystemSurfaceParams { kind: SurfaceKind; } }
