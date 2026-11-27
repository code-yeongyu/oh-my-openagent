//! Row 49: frame verbs (move, resize) read back what the window manager applied from the
//! `ConfigureNotify` that follows the request; a tiling manager that keeps its own size answers
//! `partial{kept:{width,height}}` (design row L6).

/// A window rectangle in root coordinates.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Frame {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// What the frame verb reports.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameOutcome {
    Applied(Frame),
    Partial { kept: (u32, u32) },
    /// No `ConfigureNotify` arrived before the deadline.
    Unconfirmed,
}

/// The outcome of a request for `requested`, from the `ConfigureNotify` the server sent.
#[must_use]
pub fn read_back(requested: Frame, notified: Option<Frame>) -> FrameOutcome {
    match notified {
        None => FrameOutcome::Unconfirmed,
        Some(frame) if (frame.width, frame.height) == (requested.width, requested.height) => FrameOutcome::Applied(frame),
        Some(frame) => FrameOutcome::Partial {
            kept: (frame.width, frame.height),
        },
    }
}

