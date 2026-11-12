//! The read-back rule of the window-frame verbs (design row C8): a `window.setFrame` is
//! `confirmed` only when the frame read back equals the frame asked for within 1 px on every
//! edge; an axis the window kept answers `partial{kept}`, and a window that cannot be placed at
//! all answers `WindowImmovable`.

use crate::listing::Rect;

/// The most one edge may differ from the request and still count as applied, in points.
pub const EDGE_TOLERANCE: f64 = 1.0;

/// One axis of a frame request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Axis {
    X,
    Y,
    Width,
    Height,
}

impl Axis {
    pub const ALL: [Self; 4] = [Self::X, Self::Y, Self::Width, Self::Height];

    #[must_use]
    pub const fn wire(self) -> &'static str {
        match self {
            Self::X => "x",
            Self::Y => "y",
            Self::Width => "width",
            Self::Height => "height",
        }
    }

    const fn of(self, rect: Rect) -> f64 {
        match self {
            Self::X => rect.x,
            Self::Y => rect.y,
            Self::Width => rect.width,
            Self::Height => rect.height,
        }
    }
}

/// A frame request: the axes the call names (an absent axis keeps its current value).
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct FrameAsk {
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub width: Option<f64>,
    pub height: Option<f64>,
}

impl FrameAsk {
    /// The full frame asked for, the current frame filling the axes the call leaves out.
    #[must_use]
    pub fn over(self, current: Rect) -> Rect {
        Rect {
            x: self.x.unwrap_or(current.x),
            y: self.y.unwrap_or(current.y),
            width: self.width.unwrap_or(current.width),
            height: self.height.unwrap_or(current.height),
        }
    }
}

/// What the window manager applied for a frame request.
#[derive(Debug, Clone, PartialEq)]
pub struct FrameApplied {
    /// The frame read back after the write.
    pub frame: Rect,
    /// The position cannot be set at all (`WindowImmovable`).
    pub immovable: bool,
}

/// What a frame write did, judged on the frame read back.
#[derive(Debug, Clone, PartialEq)]
pub enum FrameOutcome {
    /// Every edge within [`EDGE_TOLERANCE`] of the request.
    Confirmed,
    /// The window kept these axes against the request.
    Partial { kept: Vec<Axis> },
}

/// The read-back verdict: the axes whose read-back is off the request by more than 1 px.
#[must_use]
pub fn judge(asked: Rect, read_back: Rect) -> FrameOutcome {
    let kept: Vec<Axis> = Axis::ALL
        .into_iter()
        .filter(|axis| (axis.of(asked) - axis.of(read_back)).abs() > EDGE_TOLERANCE)
        .collect();
    if kept.is_empty() {
        FrameOutcome::Confirmed
    } else {
        FrameOutcome::Partial { kept }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const AT: Rect = Rect { x: 100.0, y: 120.0, width: 800.0, height: 600.0 };

    #[test]
    fn frame_verb_partial_kept_within_1px_rule() {
        let asked = FrameAsk { x: Some(10.0), width: Some(500.0), ..FrameAsk::default() }.over(AT);
        assert_eq!(asked, Rect { x: 10.0, y: 120.0, width: 500.0, height: 600.0 });
        let within = Rect { x: 11.0, y: 119.0, width: 500.5, height: 600.0 };
        assert_eq!(judge(asked, within), FrameOutcome::Confirmed, "1 px per edge is applied");
        let kept_width = Rect { width: 800.0, ..asked };
        assert_eq!(judge(asked, kept_width), FrameOutcome::Partial { kept: vec![Axis::Width] });
        let off_by_two = Rect { x: 12.0, ..asked };
        assert_eq!(judge(asked, off_by_two), FrameOutcome::Partial { kept: vec![Axis::X] });
    }
}
