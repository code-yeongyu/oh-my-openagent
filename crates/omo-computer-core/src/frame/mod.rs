//! Frames and coordinates: the geometry a frame maps its pixels through, the nine frame
//! refusals, the epoch reasons that supersede frames, the display composite and the frame
//! byte ladder. Every coordinate a call sends is meaningful only against one frame, and the
//! scale of every mapping lives in the frame record: nothing is rescaled outside it.

mod budget;
mod composite;
mod epoch;
mod geometry;
mod refusal;

pub use budget::{ladder, Delivery, NoJpeg, Reencode, INLINE_BUDGET_BYTES, JPEG_QUALITY};
pub use composite::{
    composite, Composite, DisplaySelector, MAX_COMPOSITE_DISPLAYS, MAX_COMPOSITE_PIXELS,
};
pub use epoch::EpochReason;
pub use geometry::{FrameGeometry, FrameKind, FrameRegion};
pub use refusal::FrameRefusal;
