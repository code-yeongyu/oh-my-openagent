//! The persistent capture helper (`native/omo-computer-capture-helper.m`): ScreenCaptureKit
//! stills for the model, the preview stream and the recording, behind one line protocol.

pub mod client;
pub mod protocol;

pub use client::LineHelper;
pub use protocol::{
    FilterKind, FrameSource, HelperError, HelperFrame, HelperReply, HelperRequest, ShotTarget,
    RECORD_MAX_FPS,
};
