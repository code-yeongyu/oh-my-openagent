//! The params of every method in the table. All params are strict: an unknown member
//! is refused, so a member the contract does not name cannot ride the wire unread.

/// A params struct: required members before `;`, optional members after it.
macro_rules! params {
    ($(#[$meta:meta])* $name:ident {
        $($(#[$ra:meta])* $req:ident: $rty:ty),* $(,)? ;
        $($(#[$oa:meta])* $opt:ident: $oty:ty),* $(,)?
    }) => {
        $(#[$meta])*
        #[derive(Debug, Clone, PartialEq, ::serde::Serialize, ::serde::Deserialize, ::schemars::JsonSchema)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        pub struct $name {
            $($(#[$ra])* pub $req: $rty,)*
            $($(#[$oa])* #[serde(default, skip_serializing_if = "Option::is_none")] pub $opt: Option<$oty>,)*
        }
    };
}

/// An exec verb's params: [`params!`] plus the call-bound authority and `observeAfter`.
macro_rules! exec_params {
    ($(#[$meta:meta])* $name:ident {
        $($(#[$ra:meta])* $req:ident: $rty:ty),* $(,)? ;
        $($(#[$oa:meta])* $opt:ident: $oty:ty),* $(,)?
    }) => {
        params! {
            $(#[$meta])* $name {
                $($(#[$ra])* $req: $rty,)* ;
                $($(#[$oa])* $opt: $oty,)*
                call_id: String,
                run_generation: u64,
                observe_after: crate::params::ObserveOptions,
            }
        }
    };
}

mod common;
mod reads;
mod v1;
mod verbs;
mod wait;

pub use common::{
    Button, CaptureCaps, Delivery, EmptyParams, ObserveOptions, ObserveRequest, OcrMode, Point,
    RequestId, SettleOptions,
};
pub use reads::{
    DrillParams, ElementAtParams, MenuItemsParams, OpenSystemSurfaceParams, SurfaceParams,
    WindowsParams, ZoomParams,
};
pub use v1::{
    AdvanceClockParams, AxPerformParams, AxRefParams, AxSetValueParams, AxTargetParams,
    AxTypeTextParams, CancelParams, CaptureParams, ClickParams, ControlGrantParams, HoldKeysParams,
    HoldMouseParams, KeyChordParams, ObserveAx, ObserveParams, OnOff, RaiseWindowParams,
    ReportMode, SessionOpenParams, StopPathResumeParams, StopPathStartParams, StopPathStopParams,
    TypeTextParams,
};
pub use verbs::{
    AppsOpenParams, AppsQuitParams, ClipboardWriteParams, DragParams, KeyDownParams, KeyUpParams,
    MenuSelectParams, MouseDownParams, MouseUpParams, MoveParams, PasteFormat, PasteParams,
    PressParams, ScrollDirection, ScrollParams, SelectTextParams, TextRange, TypeParams,
    WindowFrameParams, WindowParams,
};
pub use wait::{
    ElementState, EventKind, EventPredicate, NotificationPredicate, SessionPredicate,
    SurfacePredicate, SurfaceState, WaitForParams, WaitPredicate, WindowPredicate, WindowState,
};
