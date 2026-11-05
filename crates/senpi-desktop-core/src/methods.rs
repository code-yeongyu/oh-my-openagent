//! The FROZEN engine JSON-RPC method table and server notification set.
//!
//! One row binds a wire name to its effect, exposure, and params/result core
//! types. Adding a row also changes `schema/engine.schema.json`,
//! `docs/engine-protocol.md`, and the conformance corpus; the
//! `schema_is_fresh` / `protocol_doc_is_fresh` tests fail until they are
//! regenerated in the same commit.

use schemars::{JsonSchema, Schema, SchemaGenerator};
use serde::{Deserialize, Serialize};

use crate::menus::MenuItem;
use crate::protocol_params::{
    AdvanceClockParams, AxClickParams, AxElementAtParams, AxPerformParams, AxQueryParams, AxRefParams,
    AxSetValueParams, AxSnapshotParams, AxTypeTextParams, CancelParams, CaptureParams, CaptureRegionParams, ClipboardText, ControlGrantParams, DragParams,
    EmptyParams, HoldKeysParams, HoldMouseParams, KeyChordParams, MenuPathParams, MenuSelectParams, ObserveParams, PointParams, RaiseWindowParams, ScrollParams, StopPathResumeParams,
    StopPathStartParams, StopPathStopParams, TypeTextParams,
};
use crate::protocol_results::{
    AuditEvent, AxInputResult, ControlStateResult, EngineLog, EpochChanged, HelloResult, SessionOpenResult,
    StopPathStatus,
};
use crate::report::ActionReport;
use crate::types::{
    AxNode, AxSnapshot, CaptureResult, DesktopCapabilities, DesktopDisplay, DesktopSessionOptions, DesktopWindow, ObserveResult,
};

/// What a method may do to the desktop or to the engine's input gate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum Effect {
    /// Observes, or only narrows what the engine may do (`stopPath.stop`).
    Read,
    /// Acts on the desktop or widens what the engine may do.
    Exec,
}

/// Who may call a method.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Exposure {
    /// Any client, including bridges such as `--oneshot`.
    Public,
    /// Only the host process that spawned the engine; bridges reject it.
    HostOnly,
    /// Only when `SENPI_DESKTOP_FAKE_CLOCK=1` installed the fake clock.
    TestOnly,
}

/// One row of the method table.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MethodSpec {
    pub method: Method,
    pub name: &'static str,
    pub effect: Effect,
    pub exposure: Exposure,
    /// Rust type name of the params, as written in the table.
    pub params: &'static str,
    /// Rust type name of the result, as written in the table.
    pub result: &'static str,
}

macro_rules! method_table {
    ($($variant:ident = $name:literal, $effect:ident, $exposure:ident, $params:ty => $result:ty;)+) => {
        /// Every engine method, by wire name.
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
        pub enum Method {
            $(#[serde(rename = $name)] $variant,)+
        }

        /// The method table, in wire order.
        pub const METHODS: &[MethodSpec] = &[$(MethodSpec {
            method: Method::$variant,
            name: $name,
            effect: Effect::$effect,
            exposure: Exposure::$exposure,
            params: stringify!($params),
            result: stringify!($result),
        },)+];

        /// `(method, params schema, result schema)` for every row.
        pub(crate) fn method_schemas(generator: &mut SchemaGenerator) -> Vec<(MethodSpec, Schema, Schema)> {
            let specs = METHODS.iter().copied();
            let schemas = [$((generator.subschema_for::<$params>(), generator.subschema_for::<$result>()),)+];
            specs.zip(schemas).map(|(spec, (params, result))| (spec, params, result)).collect()
        }
    };
}

method_table! {
    EngineHello = "engine.hello", Read, Public, EmptyParams => HelloResult;
    SessionOpen = "session.open", Exec, HostOnly, DesktopSessionOptions => SessionOpenResult;
    SessionClose = "session.close", Exec, HostOnly, EmptyParams => ();
    ControlGrant = "control.grant", Exec, HostOnly, ControlGrantParams => ControlStateResult;
    ControlRevoke = "control.revoke", Exec, HostOnly, EmptyParams => ();
    ControlState = "control.state", Read, Public, EmptyParams => ControlStateResult;
    Capabilities = "capabilities", Read, Public, EmptyParams => DesktopCapabilities;
    Displays = "displays", Read, Public, EmptyParams => Vec<DesktopDisplay>;
    Windows = "windows", Read, Public, EmptyParams => Vec<DesktopWindow>;
    Capture = "capture", Read, Public, CaptureParams => CaptureResult;
    CaptureRegion = "captureRegion", Read, Public, CaptureRegionParams => CaptureResult;
    Observe = "observe", Read, Public, ObserveParams => ObserveResult;
    Click = "click", Exec, Public, PointParams => Option<ActionReport>;
    MoveMouse = "moveMouse", Exec, Public, PointParams => Option<ActionReport>;
    Drag = "drag", Exec, Public, DragParams => Option<ActionReport>;
    Scroll = "scroll", Exec, Public, ScrollParams => Option<ActionReport>;
    TypeText = "typeText", Exec, Public, TypeTextParams => Option<ActionReport>;
    KeyChord = "keyChord", Exec, Public, KeyChordParams => Option<ActionReport>;
    HoldKeys = "holdKeys", Exec, Public, HoldKeysParams => Option<ActionReport>;
    HoldMouse = "holdMouse", Exec, Public, HoldMouseParams => Option<ActionReport>;
    RaiseWindow = "raiseWindow", Exec, Public, RaiseWindowParams => Option<ActionReport>;
    MenusItems = "menus.items", Read, Public, MenuPathParams => Vec<MenuItem>;
    MenusSelect = "menus.select", Exec, Public, MenuSelectParams => Option<ActionReport>;
    ClipboardRead = "clipboard.read", Read, Public, EmptyParams => ClipboardText;
    ClipboardWrite = "clipboard.write", Exec, Public, ClipboardText => Option<ActionReport>;
    AxSnapshot = "ax.snapshot", Read, Public, AxSnapshotParams => AxSnapshot;
    AxQuery = "ax.query", Read, Public, AxQueryParams => Vec<AxNode>;
    AxElementAt = "ax.elementAt", Read, Public, AxElementAtParams => Option<AxNode>;
    AxFocused = "ax.focused", Read, Public, EmptyParams => Option<AxNode>;
    AxNode = "ax.node", Read, Public, AxRefParams => AxNode;
    AxAttributes = "ax.attributes", Read, Public, AxRefParams => Vec<(String, String)>;
    AxChildren = "ax.children", Read, Public, AxRefParams => Vec<AxNode>;
    AxParent = "ax.parent", Read, Public, AxRefParams => Option<AxNode>;
    AxPerform = "ax.perform", Exec, Public, AxPerformParams => Option<ActionReport>;
    AxSetValue = "ax.setValue", Exec, Public, AxSetValueParams => Option<ActionReport>;
    AxFocus = "ax.focus", Exec, Public, AxRefParams => Option<ActionReport>;
    AxClick = "ax.click", Exec, Public, AxClickParams => Option<ActionReport>;
    AxTypeText = "ax.typeText", Exec, Public, AxTypeTextParams => AxInputResult;
    StopPathStart = "stopPath.start", Exec, HostOnly, StopPathStartParams => StopPathStatus;
    StopPathStatus = "stopPath.status", Read, Public, EmptyParams => StopPathStatus;
    StopPathHeartbeat = "stopPath.heartbeat", Read, HostOnly, EmptyParams => ();
    StopPathStop = "stopPath.stop", Read, Public, StopPathStopParams => StopPathStatus;
    StopPathResume = "stopPath.resume", Exec, HostOnly, StopPathResumeParams => StopPathStatus;
    Cancel = "$/cancel", Read, Public, CancelParams => ();
    TestAdvanceClock = "$/test.advanceClock", Exec, TestOnly, AdvanceClockParams => ();
}

impl Method {
    #[must_use]
    pub fn spec(self) -> &'static MethodSpec {
        // Rows are generated in variant order, so the discriminant indexes them.
        &METHODS[self as usize]
    }

    /// The method named `name`, or `None` for an unknown method (`-32601`,
    /// reason `unknown`).
    #[must_use]
    pub fn from_name(name: &str) -> Option<Self> {
        METHODS.iter().find(|spec| spec.name == name).map(|spec| spec.method)
    }

    /// Whether the method answers an `ActionReport` (or, for `ax.typeText`,
    /// carries one) in a session opened with `reportMode: "object"`.
    #[must_use]
    pub const fn reports_action(self) -> bool {
        matches!(
            self,
            Self::Click
                | Self::MoveMouse
                | Self::Drag
                | Self::Scroll
                | Self::TypeText
                | Self::KeyChord
                | Self::HoldKeys
                | Self::HoldMouse
                | Self::RaiseWindow
                | Self::MenusSelect
                | Self::ClipboardWrite
                | Self::AxPerform
                | Self::AxSetValue
                | Self::AxFocus
                | Self::AxClick
                | Self::AxTypeText
        )
    }
}

/// Every server-to-client notification, by wire name.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
pub enum Notification {
    #[serde(rename = "audit")]
    Audit,
    #[serde(rename = "stopPath.changed")]
    StopPathChanged,
    #[serde(rename = "engine.log")]
    EngineLog,
    #[serde(rename = "epoch.changed")]
    EpochChanged,
}

impl Notification {
    pub const ALL: [Self; 4] = [Self::Audit, Self::StopPathChanged, Self::EngineLog, Self::EpochChanged];

    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::Audit => "audit",
            Self::StopPathChanged => "stopPath.changed",
            Self::EngineLog => "engine.log",
            Self::EpochChanged => "epoch.changed",
        }
    }

    /// Rust type name of the notification params.
    #[must_use]
    pub const fn params(self) -> &'static str {
        match self {
            Self::Audit => "AuditEvent",
            Self::StopPathChanged => "StopPathStatus",
            Self::EngineLog => "EngineLog",
            Self::EpochChanged => "EpochChanged",
        }
    }

    pub(crate) fn params_schema(self, generator: &mut SchemaGenerator) -> Schema {
        match self {
            Self::Audit => generator.subschema_for::<AuditEvent>(),
            Self::StopPathChanged => generator.subschema_for::<StopPathStatus>(),
            Self::EngineLog => generator.subschema_for::<EngineLog>(),
            Self::EpochChanged => generator.subschema_for::<EpochChanged>(),
        }
    }
}
