//! Method replies and notification params.

mod diagnosis;
mod cursor_trace;
mod exec;
mod notifications;
mod reads;
mod v1;

pub use diagnosis::{
    AttachVia, ChainLink, ChainRole, ConsentAuthority, Diagnosis, IdentityMatch, IdentityReport,
    PermissionReport, PermissionState, SpawnPath,
};
pub use exec::ExecReply;
pub use cursor_trace::{CursorTrace, CursorTraceAction, CursorTraceFrame};
pub use notifications::{AuditLine, EpochChanged, ForegroundConsent, HandConsent, HandStatus};
pub use reads::{
    CaptureReply, ClipboardContent, ConcealedReason, DisplayInfo, MenuItems, NotificationMatch,
    ObserveReply, PointerPosition, WaitOutcome, WaitResult, WindowsReply,
};
pub use v1::{
    AxNode, AxSnapshotText, AxTypeTextReply, CapabilitiesReply, CaptureMode, ControlState,
    LegacyFrame, LegacyObservation, LegacyWindow, SessionOpened, StopPathStatus, TypeTextMethod,
};
