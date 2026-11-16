//! The params of every method in the table. All params are strict: an unknown member
//! is refused, so a member the contract does not name cannot ride the wire unread.

/// A params struct: required members before `;`, optional members after it.
macro_rules! params {
    ($(#[$meta:meta])* $name:ident {
        $($(#[$ra:meta])* $req:ident: $rty:ty),* $(,)? ;
        $($(#[$oa:meta])* $opt:ident: $oty:ty),* $(,)?
    }) => {
        #[derive(Debug, Clone, PartialEq, ::serde::Serialize, ::serde::Deserialize, ::schemars::JsonSchema)]
        $(#[$meta])*
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

/// An exec verb's params with two members that are given together or not at all (`x` and
/// `y`): a lone one is refused when the params are decoded, never dropped by the reader.
/// The members decode through `$wire`; the schema is still the params' own, and publishes
/// the pairing as `dependentRequired` so a schema-driven client cannot build a lone one.
macro_rules! paired_exec_params {
    ($(#[$meta:meta])* $name:ident via $wire:ident = $wire_text:literal pairs ($first:ident, $second:ident) {
        $($(#[$ra:meta])* $req:ident: $rty:ty),* $(,)? ;
        $($(#[$oa:meta])* $opt:ident: $oty:ty),* $(,)?
    }) => {
        exec_params! {
            #[doc(hidden)]
            $wire {
                $($(#[$ra])* $req: $rty,)* ;
                $($(#[$oa])* $opt: $oty,)*
            }
        }
        exec_params! {
            $(#[$meta])*
            #[serde(try_from = $wire_text)]
            #[schemars(extend("dependentRequired" = {
                (stringify!($first)): [stringify!($second)],
                (stringify!($second)): [stringify!($first)],
            }))]
            $name {
                $($(#[$ra])* $req: $rty,)* ;
                $($(#[$oa])* $opt: $oty,)*
            }
        }
        impl TryFrom<$wire> for $name {
            type Error = String;

            fn try_from(wire: $wire) -> Result<Self, Self::Error> {
                if wire.$first.is_some() != wire.$second.is_some() {
                    return Err(format!(
                        "{} and {} are given together or not at all",
                        stringify!($first),
                        stringify!($second)
                    ));
                }
                Ok(Self {
                    $($req: wire.$req,)*
                    $($opt: wire.$opt,)*
                    call_id: wire.call_id,
                    run_generation: wire.run_generation,
                    observe_after: wire.observe_after,
                })
            }
        }
    };
}

/// A paired coordinate given on the wire: a number. Absent decodes as `None` (the member's
/// `default`); an explicit `null` is refused, so the decoder, the published schema (`number`)
/// and the generated types (absent or a number) agree on every case.
pub(crate) fn present_number<'de, D>(deserializer: D) -> Result<Option<f64>, D::Error>
where
    D: ::serde::Deserializer<'de>,
{
    <f64 as ::serde::Deserialize>::deserialize(deserializer).map(Some)
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
    AdvanceClockParams, AxFocusParams, AxPerformParams, AxRefParams, AxSetValueParams,
    AxTargetParams, AxTypeTextParams, CancelParams, CaptureParams, ClickParams, ControlGrantParams,
    HoldKeysParams, HoldMouseParams, KeyChordParams, ObserveAx, ObserveParams, OnOff,
    RaiseWindowParams, ReportMode, SessionOpenParams, StopPathResumeParams, StopPathStartParams,
    StopPathStopParams, TypeTextParams,
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
