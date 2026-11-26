//! The agent cursor's one motion planner (IS row 52, ADP-65). A pure function of a report, the
//! point the cursor is at and the display: it returns the timed path every overlay renderer draws,
//! sampled at the display's refresh rate, and the renderer adds no timing of its own. It never
//! moves the operating system's pointer and never holds an input send: the report goes out before
//! the send and the renderer animates on its own clock. Times are milliseconds on the caller's
//! clock; positions are the display's backing pixels.

use std::sync::OnceLock;

use serde::Deserialize;

use super::look::{Action, CursorLook};

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
    /// The shipped table (parsed once; the table tests prove the file parses).
    ///
    /// # Panics
    /// The shipped motion table does not parse.
    #[must_use]
    pub fn shipped() -> &'static Self {
        static TABLE: OnceLock<MotionTable> = OnceLock::new();
        TABLE.get_or_init(|| {
            serde_json::from_str(MOTION_JSON).unwrap_or_else(|error| panic!("shipped cursor motion: {error}"))
        })
    }

    /// `clamp(minMs, maxMs, baseMs + perDoublingMs * log2(1 + d / distanceUnitPoints))`, `d` in points.
    #[must_use]
    pub fn glide_ms(&self, distance_points: f64) -> f64 {
        let ms = self.base_ms + self.per_doubling_ms * (1.0 + distance_points / self.distance_unit_points).log2();
        ms.clamp(self.min_ms, self.max_ms)
    }

    /// The eased progress at the time fraction `t` in `0..=1`.
    #[must_use]
    pub fn ease(&self, t: f64) -> f64 {
        let [x1, y1, x2, y2] = self.easing;
        let bezier = |p1: f64, p2: f64, s: f64| {
            let r = 1.0 - s;
            3.0 * r * r * s * p1 + 3.0 * r * s * s * p2 + s * s * s
        };
        // x(s) and y(s) both rise on 0..=1 when every control point is in 0..=1, so bisection on
        // x with a fixed interval and step count gives a parameter, and a progress, that never
        // goes back as t grows.
        let target = t.clamp(0.0, 1.0);
        let (mut low, mut high) = (0.0_f64, 1.0_f64);
        for _ in 0..48 {
            let middle = (low + high) / 2.0;
            if bezier(x1, x2, middle) < target {
                low = middle;
            } else {
                high = middle;
            }
        }
        if target >= 1.0 {
            return 1.0;
        }
        if target <= 0.0 {
            return 0.0;
        }
        bezier(y1, y2, (low + high) / 2.0)
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

/// One report of the stream: where the next action lands and what it is.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Report {
    pub to: Point,
    pub action: Action,
    pub at_ms: f64,
}

/// The display the cursor is drawn on.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Display {
    /// Backing pixels per point.
    pub scale: f64,
    pub refresh_hz: f64,
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
    pub position: Point,
    pub opacity: f64,
}

/// The path from where the cursor is to one report's point.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Plan {
    pub from: Point,
    pub to: Point,
    pub action: Action,
    pub start_ms: f64,
    pub travel: Travel,
    frame_ms: f64,
}

impl Plan {
    #[must_use]
    pub fn new(from: Point, report: &Report, display: &Display) -> Self {
        let table = MotionTable::shipped();
        let distance_points = (report.to.x - from.x).hypot(report.to.y - from.y) / display.scale;
        let travel = if display.reduced_motion {
            Travel::Fade { duration_ms: table.fade_ms }
        } else if distance_points < CursorLook::shipped().footprint_pt {
            Travel::Place
        } else {
            Travel::Glide { duration_ms: table.glide_ms(distance_points) }
        };
        Self {
            from,
            to: report.to,
            action: report.action,
            start_ms: report.at_ms,
            travel,
            frame_ms: 1_000.0 / display.refresh_hz,
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
        let drawn = |position: Point, opacity: f64| Sample { at_ms: now_ms, position, opacity };
        match self.travel {
            Travel::Place => drawn(self.to, 1.0),
            Travel::Fade { duration_ms } => {
                drawn(self.to, MotionTable::shipped().ease(elapsed / duration_ms))
            }
            Travel::Glide { duration_ms } => {
                let progress = MotionTable::shipped().ease(elapsed / duration_ms);
                let position = Point {
                    x: self.from.x + (self.to.x - self.from.x) * progress,
                    y: self.from.y + (self.to.y - self.from.y) * progress,
                };
                drawn(position, 1.0)
            }
        }
    }

    #[must_use]
    pub fn end_ms(&self) -> f64 {
        match self.travel {
            Travel::Place => self.start_ms,
            Travel::Glide { duration_ms } | Travel::Fade { duration_ms } => self.start_ms + duration_ms,
        }
    }

    /// Every frame from the report to the end of the travel, at the display's refresh rate.
    #[must_use]
    pub fn samples(&self) -> Vec<Sample> {
        let end = self.end_ms();
        let mut samples = Vec::new();
        let mut frame = 0_u32;
        loop {
            let at = self.start_ms + f64::from(frame) * self.frame_ms;
            if at >= end {
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
