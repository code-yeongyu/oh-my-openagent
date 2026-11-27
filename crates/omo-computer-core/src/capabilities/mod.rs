//! The capability records: the v1 shape for null-mode sessions and the object-mode shape.

mod legacy;
mod parts;
mod v3;

pub use legacy::{DeliveryMode, LegacyCapabilities};
pub use parts::{
    AuthMessage, AuthMessageProbe, Availability, BackgroundBasis, BackgroundReach,
    CaptureCapability, CaptureRoute, DefaultDelivery, DisplayAwake, DisplayAwakeMechanism,
    DisplayAwakeState, InputMode, LearnedRoute, LearnedSource, SeededRoute, SessionProbes,
    ToolkitRoutes,
};
pub use v3::{
    Capabilities, Compositor, CompositorName, DeafReason, ReleaseHelper, ReleaseHelperReason,
    RouteRung, SendOnEnterKeys, StopPathCapability, StopPathKind, VirtualServer,
};
