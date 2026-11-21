//! `display(active|all|<id>)`: which displays a capture shows and the composite they form.
//! The composite is drawn at the highest scale of its displays, holds at most 16 displays and
//! `MAX_COMPOSITE_PIXELS` pixels, and names every display it dropped.

use super::geometry::FrameRegion;
use crate::listing::Rect;
use crate::results::DisplayInfo;

/// The most pixels one composite may hold (268,435,456).
pub const MAX_COMPOSITE_PIXELS: u64 = 268_435_456;
/// The most displays one composite may hold.
pub const MAX_COMPOSITE_DISPLAYS: usize = 16;

/// Which displays a display capture shows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DisplaySelector {
    /// The display the focused window covers most (the primary when no window is focused).
    Active,
    /// Every display.
    All,
    /// One display by id.
    Id(String),
}

impl DisplaySelector {
    /// `desktop` and `display:all` select every display, `display:active` the active one and
    /// `display:<id>` one display; any other target is not a display target.
    #[must_use]
    pub fn parse(target: &str) -> Option<Self> {
        if target == "desktop" {
            return Some(Self::All);
        }
        match target.strip_prefix("display:")? {
            "all" => Some(Self::All),
            "active" => Some(Self::Active),
            "" => None,
            id => Some(Self::Id(id.to_owned())),
        }
    }
}

/// The planned composite.
#[derive(Debug, Clone, PartialEq)]
pub struct Composite {
    /// The displays drawn, in listing order.
    pub shown: Vec<DisplayInfo>,
    /// The ids of the displays left out.
    pub dropped: Vec<String>,
    pub scale: f64,
    pub width: u32,
    pub height: u32,
    pub regions: Vec<FrameRegion>,
}

impl Composite {
    #[must_use]
    pub fn truncated(&self) -> bool {
        !self.dropped.is_empty()
    }
}

fn overlap(a: &Rect, b: &Rect) -> f64 {
    let width = (a.x + a.width).min(b.x + b.width) - a.x.max(b.x);
    let height = (a.y + a.height).min(b.y + b.height) - a.y.max(b.y);
    width.max(0.0) * height.max(0.0)
}

fn bounding(displays: &[DisplayInfo]) -> Rect {
    let left = displays
        .iter()
        .map(|d| d.bounds.x)
        .fold(f64::INFINITY, f64::min);
    let top = displays
        .iter()
        .map(|d| d.bounds.y)
        .fold(f64::INFINITY, f64::min);
    let right = displays
        .iter()
        .map(|d| d.bounds.x + d.bounds.width)
        .fold(f64::NEG_INFINITY, f64::max);
    let bottom = displays
        .iter()
        .map(|d| d.bounds.y + d.bounds.height)
        .fold(f64::NEG_INFINITY, f64::max);
    Rect {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
    }
}

/// The whole pixels a logical length covers at `scale`.
fn pixels(length: f64, scale: f64) -> u64 {
    let scaled = (length * scale).ceil();
    if scaled.is_finite() && scaled > 0.0 {
        // Clamped to the u32 range first, so the cast cannot wrap.
        scaled.min(f64::from(u32::MAX)) as u64
    } else {
        0
    }
}

fn size(displays: &[DisplayInfo], scale: f64) -> (u64, u64) {
    let bounds = bounding(displays);
    (pixels(bounds.width, scale), pixels(bounds.height, scale))
}

fn top_scale(displays: &[DisplayInfo]) -> f64 {
    displays
        .iter()
        .map(|display| display.scale)
        .filter(|scale| scale.is_finite() && *scale > 0.0)
        .fold(1.0, f64::max)
}

fn active<'a>(displays: &'a [DisplayInfo], focused: Option<&Rect>) -> Option<&'a DisplayInfo> {
    let covered = focused.and_then(|window| {
        displays
            .iter()
            .map(|display| (display, overlap(&display.bounds, window)))
            .filter(|(_, area)| *area > 0.0)
            .fold(None::<(&DisplayInfo, f64)>, |best, next| match best {
                Some(best) if best.1 >= next.1 => Some(best),
                _ => Some(next),
            })
            .map(|(display, _)| display)
    });
    covered
        .or_else(|| displays.iter().find(|display| display.primary))
        .or_else(|| displays.first())
}

/// The composite `selector` asks for over `displays`; `focused` is the focused window's bounds.
/// `None` when the selector names no listed display.
#[must_use]
pub fn composite(
    displays: &[DisplayInfo],
    selector: &DisplaySelector,
    focused: Option<&Rect>,
) -> Option<Composite> {
    let wanted: Vec<DisplayInfo> = match selector {
        DisplaySelector::All => displays.to_vec(),
        DisplaySelector::Active => vec![active(displays, focused)?.clone()],
        DisplaySelector::Id(id) => vec![displays.iter().find(|display| &display.id == id)?.clone()],
    };
    if wanted.is_empty() {
        return None;
    }
    let scale = top_scale(&wanted);
    let mut shown: Vec<DisplayInfo> = Vec::new();
    let mut dropped = Vec::new();
    for display in wanted {
        let mut candidate = shown.clone();
        candidate.push(display.clone());
        let (width, height) = size(&candidate, scale);
        if shown.len() < MAX_COMPOSITE_DISPLAYS
            && width.saturating_mul(height) <= MAX_COMPOSITE_PIXELS
        {
            shown = candidate;
        } else {
            dropped.push(display.id);
        }
    }
    if shown.is_empty() {
        return None;
    }
    let bounds = bounding(&shown);
    let (width, height) = size(&shown, scale);
    let regions = shown
        .iter()
        .map(|display| FrameRegion {
            logical: display.bounds,
            pixel: Rect {
                x: (display.bounds.x - bounds.x) * scale,
                y: (display.bounds.y - bounds.y) * scale,
                width: display.bounds.width * scale,
                height: display.bounds.height * scale,
            },
        })
        .collect();
    Some(Composite {
        shown,
        dropped,
        scale,
        width: u32::try_from(width).unwrap_or(u32::MAX),
        height: u32::try_from(height).unwrap_or(u32::MAX),
        regions,
    })
}
