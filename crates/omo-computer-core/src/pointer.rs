//! Pointer step plans (design row C9, R48b): `scroll{clicks}` sends one counted wheel step per
//! click, refused past [`MAX_SCROLL_STEPS`]; a pixel delta `dx`/`dy` goes as ONE event whose
//! conversion to steps, and its per-route cap, is the backend's (the report counts what it
//! delivered; nothing is clamped silently).

use crate::backend::InputEvent;
use crate::params::ScrollDirection;

/// The most wheel steps one `scroll` sends (R48 item 3, re-pin item 42: the old tree's X11
/// backend capped wheel clicks at 1,000 per call, input/xtest.rs line 21 at d79bc6cc9a).
pub const MAX_SCROLL_STEPS: u32 = 1_000;

/// A scroll asking for more steps than [`MAX_SCROLL_STEPS`], refused before any input is sent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TooManySteps {
    pub requested: u64,
}

/// What a `scroll` asks for: a direction and a step count, or a raw wheel delta.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ScrollAsk {
    Steps { direction: ScrollDirection, clicks: u32 },
    Delta { dx: f64, dy: f64 },
}

impl ScrollAsk {
    /// `direction` wins over a raw delta; a call with neither scrolls one step down.
    #[must_use]
    pub fn read(dx: Option<f64>, dy: Option<f64>, clicks: Option<u32>, direction: Option<ScrollDirection>) -> Self {
        match (direction, dx, dy) {
            (Some(direction), _, _) => Self::Steps { direction, clicks: clicks.unwrap_or(1) },
            (None, None, None) => Self::Steps { direction: ScrollDirection::Down, clicks: clicks.unwrap_or(1) },
            (None, dx, dy) => Self::Delta { dx: dx.unwrap_or(0.0), dy: dy.unwrap_or(0.0) },
        }
    }

    /// The wheel steps, one event each.
    ///
    /// # Errors
    /// [`TooManySteps`] past [`MAX_SCROLL_STEPS`].
    pub fn steps(self) -> Result<Vec<InputEvent>, TooManySteps> {
        let (count, dx, dy) = match self {
            Self::Steps { direction, clicks } => {
                let (dx, dy) = match direction {
                    ScrollDirection::Up => (0.0, -1.0),
                    ScrollDirection::Down => (0.0, 1.0),
                    ScrollDirection::Left => (-1.0, 0.0),
                    ScrollDirection::Right => (1.0, 0.0),
                };
                (u64::from(clicks.max(1)), dx, dy)
            }
            Self::Delta { dx, dy } => return Ok(vec![InputEvent::Scroll { dx, dy }]),
        };
        if count > u64::from(MAX_SCROLL_STEPS) {
            return Err(TooManySteps { requested: count });
        }
        Ok((0..count).map(|_| InputEvent::Scroll { dx, dy }).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_direction_sends_one_counted_step_per_click() {
        let steps = ScrollAsk::read(None, None, Some(3), Some(ScrollDirection::Up)).steps();
        assert_eq!(steps, Ok(vec![InputEvent::Scroll { dx: 0.0, dy: -1.0 }; 3]));
    }

    #[test]
    fn clicks_past_the_bound_are_refused_and_a_pixel_delta_is_one_unbounded_event() {
        assert_eq!(ScrollAsk::read(Some(0.0), Some(2.5), None, None).steps(), Ok(vec![InputEvent::Scroll { dx: 0.0, dy: 2.5 }]));
        assert_eq!(ScrollAsk::read(None, None, Some(MAX_SCROLL_STEPS), Some(ScrollDirection::Down)).steps().map(|s| s.len()), Ok(1_000));
        assert_eq!(
            ScrollAsk::read(None, None, Some(MAX_SCROLL_STEPS + 1), Some(ScrollDirection::Down)).steps(),
            Err(TooManySteps { requested: 1_001 })
        );
        assert_eq!(ScrollAsk::read(None, Some(5_000.0), None, None).steps().map(|s| s.len()), Ok(1), "a pixel delta is not bounded by the core");
    }
}
