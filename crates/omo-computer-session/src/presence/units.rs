//! The units the cursor planner keeps apart. Positions travel in the display's backing pixels;
//! the motion table and the pointer's footprint measure in logical points; a `Scale` is the only
//! way from one to the other. `Scale` and `RefreshRate` are parsed once at the display boundary,
//! so the planner never divides by a zero, negative or non-finite display value.

use std::fmt;

/// A length in the display's backing pixels.
#[derive(Debug, Clone, Copy, PartialEq, PartialOrd)]
pub struct Pixels(pub f64);

/// A length in logical points.
#[derive(Debug, Clone, Copy, PartialEq, PartialOrd)]
pub struct Points(pub f64);

/// A position on the display, in backing pixels.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PixelPoint {
    pub x: f64,
    pub y: f64,
}

impl PixelPoint {
    #[must_use]
    pub fn distance(self, other: Self) -> Pixels {
        Pixels((other.x - self.x).hypot(other.y - self.y))
    }

    /// The point `progress` of the way from `self` to `to`.
    #[must_use]
    pub fn toward(self, to: Self, progress: f64) -> Self {
        Self { x: self.x + (to.x - self.x) * progress, y: self.y + (to.y - self.y) * progress }
    }
}

/// A display value that is not a finite number above zero.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum InvalidDisplay {
    Scale(f64),
    RefreshRate(f64),
}

impl fmt::Display for InvalidDisplay {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Scale(value) => write!(f, "display scale {value} is not a finite number above zero"),
            Self::RefreshRate(value) => write!(f, "refresh rate {value} Hz is not a finite number above zero"),
        }
    }
}

impl std::error::Error for InvalidDisplay {}

fn finite_and_positive(value: f64) -> bool {
    value.is_finite() && value > 0.0
}

/// Backing pixels per point.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Scale(f64);

impl Scale {
    /// # Errors
    /// `InvalidDisplay::Scale` when `pixels_per_point` is not finite and above zero.
    pub fn new(pixels_per_point: f64) -> Result<Self, InvalidDisplay> {
        if finite_and_positive(pixels_per_point) {
            Ok(Self(pixels_per_point))
        } else {
            Err(InvalidDisplay::Scale(pixels_per_point))
        }
    }

    #[must_use]
    pub fn to_points(self, length: Pixels) -> Points {
        Points(length.0 / self.0)
    }
}

/// How often the display draws a frame.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RefreshRate(f64);

impl RefreshRate {
    /// # Errors
    /// `InvalidDisplay::RefreshRate` when `hz` is not finite and above zero.
    pub fn new(hz: f64) -> Result<Self, InvalidDisplay> {
        if finite_and_positive(hz) {
            Ok(Self(hz))
        } else {
            Err(InvalidDisplay::RefreshRate(hz))
        }
    }

    #[must_use]
    pub fn frame_ms(self) -> f64 {
        1_000.0 / self.0
    }
}
