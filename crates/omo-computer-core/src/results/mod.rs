//! Method replies and notification params.

mod diagnosis;
mod exec;
mod notifications;
mod reads;
mod v1;

pub use diagnosis::{
    AttachVia, ChainLink, ChainRole, ConsentAuthority, Diagnosis, IdentityMatch, IdentityReport,
    PermissionReport, PermissionState, SpawnPath,
};
pub use exec::ExecReply;
pub use notifications::{AuditLine, EpochChanged, ForegroundConsent, HandConsent, HandStatus};
pub use reads::{
    CaptureReply, ClipboardContent, ConcealedReason, DisplayInfo, MenuItems, ObserveReply,
    PointerPosition, WaitOutcome, WaitResult, WindowsReply,
};
pub use v1::{
    AxNode, AxSnapshotText, AxTypeTextReply, CapabilitiesReply, CaptureMode, ControlState,
    LegacyFrame, LegacyObservation, LegacyWindow, SessionOpened, StopPathStatus, TypeTextMethod,
};
