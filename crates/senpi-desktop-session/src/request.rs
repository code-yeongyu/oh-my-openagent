//! The requests the session thread serves and the replies it produces.

use senpi_desktop_core::menus::MenuItem;
use senpi_desktop_core::protocol_params::{
    AxClickParams, AxElementAtParams, AxPerformParams, AxQueryParams, AxRefParams, AxSetValueParams, AxSnapshotParams,
    CaptureParams, CaptureRegionParams, ClipboardText, ControlGrantParams, DragParams, KeyChordParams, MenuPathParams, MenuSelectParams, PointParams,
    HoldKeysParams, HoldMouseParams, ObserveParams, RaiseWindowParams, ScrollParams, TypeTextParams,
};
use senpi_desktop_core::protocol_results::ControlStateResult;
use senpi_desktop_core::types::{
    AxNode, AxSnapshot, CaptureResult, DesktopCapabilities, DesktopDisplay, DesktopWindow, ObserveResult,
};
use serde::Serialize;

/// One backend request of an open session, carrying its engine method's
/// params (`session.open` / `session.close` are [`crate::Session`] methods).
#[derive(Debug, Clone, PartialEq)]
pub enum Op {
    Displays,
    Windows,
    Capture(CaptureParams),
    Observe(ObserveParams),
    CaptureRegion(CaptureRegionParams),
    Click(PointParams),
    MoveMouse(PointParams),
    Drag(DragParams),
    Scroll(ScrollParams),
    TypeText(TypeTextParams),
    KeyChord(KeyChordParams),
    HoldKeys(HoldKeysParams),
    HoldMouse(HoldMouseParams),
    RaiseWindow(RaiseWindowParams),
    AxSnapshot(AxSnapshotParams),
    AxQuery(AxQueryParams),
    AxElementAt(AxElementAtParams),
    AxFocused,
    AxNode(AxRefParams),
    AxAttributes(AxRefParams),
    AxChildren(AxRefParams),
    AxParent(AxRefParams),
    AxPerform(AxPerformParams),
    AxSetValue(AxSetValueParams),
    AxFocus(AxRefParams),
    AxClick(AxClickParams),
    ClipboardRead,
    ClipboardWrite(ClipboardText),
    ControlGrant(ControlGrantParams),
    ControlRevoke,
    ControlState,
    MenuItems(MenuPathParams),
    MenusSelect(MenuSelectParams),
}

/// A request's result; serializes to its engine method's wire `result`
/// (`Unit` is `null`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(untagged)]
pub enum Response {
    Unit,
    Capabilities(DesktopCapabilities),
    Displays(Vec<DesktopDisplay>),
    Windows(Vec<DesktopWindow>),
    Capture(CaptureResult),
    Observe(ObserveResult),
    Snapshot(AxSnapshot),
    Node(AxNode),
    MaybeNode(Option<AxNode>),
    Nodes(Vec<AxNode>),
    Attributes(Vec<(String, String)>),
    Clipboard(ClipboardText),
    ControlState(ControlStateResult),
    MenuItems(Vec<MenuItem>),
}
