//! Params of the exec verbs the model-facing surface adds.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::common::{Button, Delivery, ObserveRequest, Point};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum PasteFormat {
    Text,
    Markdown,
    Html,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum ScrollDirection {
    Up,
    Down,
    Left,
    Right,
}

/// `selectText`: an index range or the text to select.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(untagged)]
pub enum TextRange {
    Span { start: u32, end: u32 },
    Text { text: String },
}

exec_params! { MoveParams { target: String, x: f64, y: f64; frame_id: String, } }
exec_params! { MouseDownParams { target: String; button: Button, x: f64, y: f64, frame_id: String, } }
exec_params! { MouseUpParams { target: String; button: Button, } }
exec_params! { KeyDownParams { target: String, chord: String; frame_id: String, force: bool, } }
exec_params! { KeyUpParams { target: String, chord: String; } }
exec_params! {
    DragParams {
        target: String, from: Point, to: Point;
        button: Button, modifiers: Vec<String>, frame_id: String, path: Vec<Point>,
    }
}
exec_params! {
    TypeParams {
        text: String;
        target: String, #[serde(rename = "ref")] reference: String, delivery: Delivery, force: bool,
    }
}
exec_params! {
    PressParams {
        chord: String;
        target: String, #[serde(rename = "ref")] reference: String, repeat: u32, force: bool, delivery: Delivery,
    }
}
exec_params! { PasteParams { target: String, text: String; format: PasteFormat, force: bool, } }
exec_params! {
    ScrollParams {
        target: String, x: f64, y: f64;
        dx: f64, dy: f64, clicks: u32, direction: ScrollDirection, delivery: Delivery,
    }
}
exec_params! { SelectTextParams { #[serde(rename = "ref")] reference: String, range: TextRange; } }
exec_params! { MenuSelectParams { target: String, path: Vec<String>; delivery: Delivery, } }
exec_params! { AppsOpenParams { target: String; activate: bool, reveal: bool, observe: ObserveRequest, } }
exec_params! { AppsQuitParams { target: String; force: bool, } }
exec_params! { WindowParams { target: String; } }
exec_params! { WindowFrameParams { target: String; x: f64, y: f64, width: f64, height: f64, } }
exec_params! { ClipboardWriteParams { text: String; format: PasteFormat, } }
