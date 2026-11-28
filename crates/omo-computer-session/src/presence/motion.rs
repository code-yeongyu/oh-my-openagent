//! The agent cursor's one motion planner (IS row 52, ADP-65). A pure function of a report, the
//! point the cursor is at and the display: it returns the timed path every overlay renderer draws,
//! sampled at the display's refresh rate, and the renderer adds no timing of its own. It never
//! moves the operating system's pointer and never holds an input send: the report goes out before
//! the send and the renderer animates on its own clock. Times are milliseconds on the caller's
//! clock; positions are backing pixels and distances are converted to points through the scale.

use std::cmp::Ordering;
use std::sync::OnceLock;

use serde::Deserialize;

use super::look::{Action, CursorLook};
use super::units::{PixelPoint, Points, RefreshRate, Scale};

pub(super) const MOTION_JSON: &str = include_str!("cursor-motion.json");

/// The glide's constants, from `cursor-motion.json`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MotionTable {
    pub v: u32,
    pub min_ms: f64,
    pub max_ms: f64,
    pub base_ms: f64,
    pub per_doubling_ms: f64,
    pub distance_unit_points: f64,
    /// The progress curve as cubic-bezier control points `x1, y1, x2, y2`, each in `0..=1`.
    pub easing: [f64; 4],
    /// The reduced-motion fade at the target.
    pub fade_ms: f64,
}

impl MotionTable {
    /// The shipped table, parsed once.
    ///
    /// # Panics
    /// Never for the compiled-in file: `packaged_motion_table_is_byte_equal_to_the_crate_table` parses it.
    #[must_use]
    #[expect(clippy::expect_used, reason = "the table is compiled in and its tests parse it")]
    pub fn shipped() -> &'static Self {
        static TABLE: OnceLock<MotionTable> = OnceLock::new();
        TABLE.get_or_init(|| serde_json::from_str(MOTION_JSON).expect("the shipped cursor-motion.json parses"))
    }

    /// `clamp(minMs, maxMs, baseMs + perDoublingMs * log2(1 + d / distanceUnitPoints))`.
    #[must_use]
    pub fn glide_ms(&self, distance: Points) -> f64 {
        let ms = self.base_ms + self.per_doubling_ms * (1.0 + distance.0 / self.distance_unit_points).log2();
        ms.clamp(self.min_ms, self.max_ms)
    }

    /// The eased progress at the time fraction `t` in `0..=1`.
    #[must_use]
    pub fn ease(&self, t: f64) -> f64 {
        if t >= 1.0 {
            return 1.0;
        }
        if t <= 0.0 {
            return 0.0;
        }
        let [x1, y1, x2, y2] = self.easing;
        let bezier = |p1: f64, p2: f64, s: f64| {
            let r = 1.0 - s;
            3.0 * r * r * s * p1 + 3.0 * r * s * s * p2 + s * s * s
        };
        // x(s) and y(s) both rise on 0..=1 when every control point is in 0..=1, so bisection on
        // x with a fixed interval and step count gives a parameter, and a progress, that never
        // goes back as t grows.
        let (mut low, mut high) = (0.0_f64, 1.0_f64);
        for _ in 0..48 {
            let middle = f64::midpoint(low, high);
            if bezier(x1, x2, middle) < t {
                low = middle;
            } else {
                high = middle;
            }
        }
        bezier(y1, y2, f64::midpoint(low, high))
    }
}

/// One report of the stream: where the next action lands and what it is.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Report {
    pub to: PixelPoint,
    pub action: Action,
    pub at_ms: f64,
}

/// The display the cursor is drawn on; its scale and refresh rate are parsed at the boundary.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Display {
    pub scale: Scale,
    pub refresh: RefreshRate,
    pub reduced_motion: bool,
}

/// How the cursor reaches the report's point.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Travel {
    Glide { duration_ms: f64 },
    /// A hop inside the pointer's footprint: drawn at the target at once.
    Place,
    /// Reduced motion: drawn at the target, fading in.
    Fade { duration_ms: f64 },
}

/// One drawn frame.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Sample {
    pub at_ms: f64,
    pub position: PixelPoint,
    pub opacity: f64,
}

/// The path from where the cursor is to one report's point.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Plan {
    pub from: PixelPoint,
    pub to: PixelPoint,
    pub action: Action,
    pub start_ms: f64,
    pub travel: Travel,
    frame_ms: f64,
}

impl Plan {
    #[must_use]
    pub fn new(from: PixelPoint, report: &Report, display: &Display) -> Self {
        let table = MotionTable::shipped();
        let distance = display.scale.to_points(from.distance(report.to));
        let travel = if display.reduced_motion {
            Travel::Fade { duration_ms: table.fade_ms }
        } else if distance < Points(CursorLook::shipped().footprint_pt) {
            Travel::Place
        } else {
            Travel::Glide { duration_ms: table.glide_ms(distance) }
        };
        Self {
            from,
            to: report.to,
            action: report.action,
            start_ms: report.at_ms,
            travel,
            frame_ms: display.refresh.frame_ms(),
        }
    }

    /// A newer report: the next path starts where this one has reached at the report's time.
    #[must_use]
    pub fn retarget(&self, report: &Report, display: &Display) -> Self {
        Self::new(self.at(report.at_ms).position, report, display)
    }

    /// Where the cursor is drawn at `now_ms`.
    #[must_use]
    pub fn at(&self, now_ms: f64) -> Sample {
        let elapsed = (now_ms - self.start_ms).max(0.0);
        let table = MotionTable::shipped();
        let (position, opacity) = match self.travel {
            Travel::Place => (self.to, 1.0),
            Travel::Fade { duration_ms } => (self.to, table.ease(elapsed / duration_ms)),
            Travel::Glide { duration_ms } => (self.from.toward(self.to, table.ease(elapsed / duration_ms)), 1.0),
        };
        Sample { at_ms: now_ms, position, opacity }
    }

    #[must_use]
    pub fn end_ms(&self) -> f64 {
        match self.travel {
            Travel::Place => self.start_ms,
            Travel::Glide { duration_ms } | Travel::Fade { duration_ms } => self.start_ms + duration_ms,
        }
    }

    /// Every frame from the report to the end of the travel, at the display's refresh rate. The
    /// frame step is finite and positive (`RefreshRate`), and a frame time that is not below the
    /// end (including a non-finite one) ends the path, so this always returns.
    #[must_use]
    pub fn samples(&self) -> Vec<Sample> {
        let end = self.end_ms();
        let mut samples = Vec::new();
        let mut frame = 0_u32;
        loop {
            let at = self.start_ms + f64::from(frame) * self.frame_ms;
            if at.partial_cmp(&end) != Some(Ordering::Less) {
                samples.push(self.at(end));
                return samples;
            }
            samples.push(self.at(at));
            frame += 1;
        }
    }
}

#[cfg(test)]
#[path = "motion_test.rs"]
mod tests;
