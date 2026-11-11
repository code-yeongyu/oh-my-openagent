//! The method table: one row per wire method with its effect, exposure, params and result.
//! Rows are added, never removed, under protocol 1. The schema, the protocol doc and the
//! TypeScript package are generated from it.

use schemars::{Schema, SchemaGenerator};

use super::spec::{Effect, Exposure, MethodSpec, PeerKind};
use crate::hello::Hello;
use crate::listing::{AppInfo, ElementInfo, Surface};
use crate::observation::{Frame, Observation};
use crate::params::{
    AdvanceClockParams, AppsOpenParams, AppsQuitParams, AxPerformParams, AxRefParams,
    AxSetValueParams, AxTargetParams, AxTypeTextParams, CancelParams, CaptureParams, ClickParams,
    ClipboardWriteParams, ControlGrantParams, DragParams, DrillParams, ElementAtParams,
    EmptyParams, HoldKeysParams, HoldMouseParams, KeyChordParams, KeyDownParams, KeyUpParams,
    MenuItemsParams, MenuSelectParams, MouseDownParams, MouseUpParams, MoveParams, ObserveParams,
    OpenSystemSurfaceParams, PasteParams, PressParams, RaiseWindowParams, ScrollParams,
    SelectTextParams, SessionOpenParams, StopPathResumeParams, StopPathStartParams,
    StopPathStopParams, SurfaceParams, TypeParams, TypeTextParams, WaitForParams,
    WindowFrameParams, WindowParams, WindowsParams, ZoomParams,
};
use crate::results::{
    AxNode, AxSnapshotText, AxTypeTextReply, CapabilitiesReply, CaptureReply, ClipboardContent,
    ControlState, Diagnosis, DisplayInfo, ExecReply, MenuItems, ObserveReply, PointerPosition,
    SessionOpened, StopPathStatus, WaitResult, WindowsReply,
};

macro_rules! method_table {
    ($($variant:ident = $name:literal, $effect:ident, $exposure:expr, $params:ty => $result:ty;)+) => {
        /// Every engine method, by wire name.
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
        pub enum Method { $($variant,)+ }

        /// The method table in wire order; `METHODS[m as usize]` is the row of `m`.
        pub const METHODS: &[MethodSpec] = &[$(MethodSpec {
            method: Method::$variant,
            name: $name,
            effect: Effect::$effect,
            exposure: $exposure,
            params: stringify!($params),
            result: stringify!($result),
        },)+];

        impl Method {
            /// Wire validation of a request's params: they parse into this row's params type.
            ///
            /// # Errors
            /// The parse error, naming the first member that does not fit.
            pub fn validate_params(self, params: serde_json::Value) -> Result<(), serde_json::Error> {
                match self { $(Self::$variant => serde_json::from_value::<$params>(params).map(drop),)+ }
            }

            /// Wire validation of a reply: it parses into this row's result type.
            ///
            /// # Errors
            /// The parse error, naming the first member that does not fit.
            pub fn validate_result(self, result: serde_json::Value) -> Result<(), serde_json::Error> {
                match self { $(Self::$variant => serde_json::from_value::<$result>(result).map(drop),)+ }
            }
        }

        /// `(row, params schema, result schema)` for every row.
        pub(crate) fn method_schemas(generator: &mut SchemaGenerator) -> Vec<(MethodSpec, Schema, Schema)> {
            vec![$((METHODS[Method::$variant as usize], generator.subschema_for::<$params>(), generator.subschema_for::<$result>()),)+]
        }
    };
}

const PUBLIC: Exposure = Exposure::Public;
const SESSION: Exposure = Exposure::HostOnly(PeerKind::Session);
const AUTHORITY: Exposure = Exposure::HostOnly(PeerKind::Authority);
const TEST: Exposure = Exposure::TestOnly;

method_table! {
    EngineHello = "engine.hello", Read, PUBLIC, EmptyParams => Hello;
    SessionOpen = "session.open", Read, SESSION, SessionOpenParams => SessionOpened;
    Capabilities = "capabilities", Read, PUBLIC, EmptyParams => CapabilitiesReply;
    Windows = "windows", Read, PUBLIC, WindowsParams => WindowsReply;
    Capture = "capture", Read, PUBLIC, CaptureParams => CaptureReply;
    Observe = "observe", Read, PUBLIC, ObserveParams => ObserveReply;
    AxSnapshot = "ax.snapshot", Read, PUBLIC, AxTargetParams => AxSnapshotText;
    AxNode = "ax.node", Read, PUBLIC, AxRefParams => AxNode;
    AxChildren = "ax.children", Read, PUBLIC, AxRefParams => Vec<AxNode>;
    AxFocused = "ax.focused", Read, PUBLIC, EmptyParams => Option<AxNode>;
    Click = "click", Exec, PUBLIC, ClickParams => ExecReply;
    TypeText = "typeText", Exec, PUBLIC, TypeTextParams => ExecReply;
    KeyChord = "keyChord", Exec, PUBLIC, KeyChordParams => ExecReply;
    HoldKeys = "holdKeys", Exec, PUBLIC, HoldKeysParams => ExecReply;
    HoldMouse = "holdMouse", Exec, PUBLIC, HoldMouseParams => ExecReply;
    RaiseWindow = "raiseWindow", Exec, PUBLIC, RaiseWindowParams => ExecReply;
    AxSetValue = "ax.setValue", Exec, PUBLIC, AxSetValueParams => ExecReply;
    AxPerform = "ax.perform", Exec, PUBLIC, AxPerformParams => ExecReply;
    AxFocus = "ax.focus", Exec, PUBLIC, AxRefParams => ExecReply;
    AxTypeText = "ax.typeText", Exec, PUBLIC, AxTypeTextParams => AxTypeTextReply;
    ControlGrant = "control.grant", Exec, AUTHORITY, ControlGrantParams => ControlState;
    StopPathStart = "stopPath.start", Exec, AUTHORITY, StopPathStartParams => StopPathStatus;
    StopPathStatus = "stopPath.status", Read, PUBLIC, EmptyParams => StopPathStatus;
    StopPathHeartbeat = "stopPath.heartbeat", Read, SESSION, EmptyParams => ();
    StopPathStop = "stopPath.stop", Read, PUBLIC, StopPathStopParams => StopPathStatus;
    StopPathResume = "stopPath.resume", Exec, AUTHORITY, StopPathResumeParams => StopPathStatus;
    DesktopShutdown = "desktop.shutdown", Exec, AUTHORITY, EmptyParams => ();
    Cancel = "$/cancel", Read, PUBLIC, CancelParams => ();
    TestAdvanceClock = "$/test.advanceClock", Exec, TEST, AdvanceClockParams => ();
}
