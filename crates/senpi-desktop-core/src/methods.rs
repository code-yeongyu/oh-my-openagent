//! The FROZEN engine JSON-RPC method table and server notification set.
//!
//! One row binds a wire name to its effect, exposure, and params/result core
//! types. Adding a row also changes `schema/engine.schema.json`,
//! `docs/engine-protocol.md`, and the conformance corpus; the
//! `schema_is_fresh` / `protocol_doc_is_fresh` tests fail until they are
//! regenerated in the same commit.

use schemars::{JsonSchema, Schema, SchemaGenerator};
use serde::{Deserialize, Serialize};

use crate::protocol_params::{
    AdvanceClockParams, AxClickParams, AxElementAtParams, AxPerformParams, AxQueryParams, AxRefParams,
    AxSetValueParams, AxSnapshotParams, CancelParams, CaptureParams, ClipboardText, DragParams, EmptyParams,
    KeyChordParams, PointParams, RaiseWindowParams, ScrollParams, StopPathResumeParams, StopPathStartParams,
    StopPathStopParams, TypeTextParams,
};
use crate::protocol_results::{AuditEvent, EngineLog, HelloResult, SessionOpenResult, StopPathStatus};
use crate::types::{
    AxNode, AxSnapshot, CaptureResult, DesktopCapabilities, DesktopDisplay, DesktopSessionOptions,
    DesktopWindow,
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
    Capabilities = "capabilities", Read, Public, EmptyParams => DesktopCapabilities;
    Displays = "displays", Read, Public, EmptyParams => Vec<DesktopDisplay>;
    Windows = "windows", Read, Public, EmptyParams => Vec<DesktopWindow>;
    Capture = "capture", Read, Public, CaptureParams => CaptureResult;
    Click = "click", Exec, Public, PointParams => ();
    MoveMouse = "moveMouse", Exec, Public, PointParams => ();
    Drag = "drag", Exec, Public, DragParams => ();
    Scroll = "scroll", Exec, Public, ScrollParams => ();
    TypeText = "typeText", Exec, Public, TypeTextParams => ();
    KeyChord = "keyChord", Exec, Public, KeyChordParams => ();
    RaiseWindow = "raiseWindow", Exec, Public, RaiseWindowParams => ();
    ClipboardRead = "clipboard.read", Read, Public, EmptyParams => ClipboardText;
    ClipboardWrite = "clipboard.write", Exec, Public, ClipboardText => ();
    AxSnapshot = "ax.snapshot", Read, Public, AxSnapshotParams => AxSnapshot;
    AxQuery = "ax.query", Read, Public, AxQueryParams => Vec<AxNode>;
    AxElementAt = "ax.elementAt", Read, Public, AxElementAtParams => Option<AxNode>;
    AxFocused = "ax.focused", Read, Public, EmptyParams => Option<AxNode>;
    AxNode = "ax.node", Read, Public, AxRefParams => AxNode;
    AxAttributes = "ax.attributes", Read, Public, AxRefParams => Vec<(String, String)>;
    AxChildren = "ax.children", Read, Public, AxRefParams => Vec<AxNode>;
    AxParent = "ax.parent", Read, Public, AxRefParams => Option<AxNode>;
    AxPerform = "ax.perform", Exec, Public, AxPerformParams => ();
    AxSetValue = "ax.setValue", Exec, Public, AxSetValueParams => ();
    AxFocus = "ax.focus", Exec, Public, AxRefParams => ();
    AxClick = "ax.click", Exec, Public, AxClickParams => ();
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
        METHODS
            .iter()
            .find(|spec| spec.name == name)
            .map(|spec| spec.method)
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
}

impl Notification {
    pub const ALL: [Self; 3] = [Self::Audit, Self::StopPathChanged, Self::EngineLog];

    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::Audit => "audit",
            Self::StopPathChanged => "stopPath.changed",
            Self::EngineLog => "engine.log",
        }
    }

    /// Rust type name of the notification params.
    #[must_use]
    pub const fn params(self) -> &'static str {
        match self {
            Self::Audit => "AuditEvent",
            Self::StopPathChanged => "StopPathStatus",
            Self::EngineLog => "EngineLog",
        }
    }

    pub(crate) fn params_schema(self, generator: &mut SchemaGenerator) -> Schema {
        match self {
            Self::Audit => generator.subschema_for::<AuditEvent>(),
            Self::StopPathChanged => generator.subschema_for::<StopPathStatus>(),
            Self::EngineLog => generator.subschema_for::<EngineLog>(),
        }
    }
}
