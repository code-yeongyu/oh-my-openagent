//! `displays()`: every active display in points with its backing scale, primary first.

use omo_computer_core::listing::Rect;
use omo_computer_core::results::DisplayInfo;

use crate::capture::types::DisplayRecord;

/// The display records as `displays()` answers them: the main display first, then by origin.
#[must_use]
pub fn infos(records: &[DisplayRecord]) -> Vec<DisplayInfo> {
    let _ = records;
    Vec::new()
}

/// Backing pixels per point.
#[must_use]
pub fn scale(display: &DisplayRecord) -> f64 {
    if display.bounds.width > 0.0 {
        f64::from(display.pixel_width) / display.bounds.width
    } else {
        1.0
    }
}

/// The display holding the centre of `rect`, else the one it overlaps most.
#[must_use]
pub fn display_of<'a>(displays: &'a [DisplayRecord], rect: &Rect) -> Option<&'a DisplayRecord> {
    let (cx, cy) = (rect.x + rect.width / 2.0, rect.y + rect.height / 2.0);
    displays
        .iter()
        .find(|d| contains(&d.bounds, cx, cy))
        .or_else(|| {
            displays
                .iter()
                .map(|d| (d, overlap(&d.bounds, rect)))
                .filter(|(_, area)| *area > 0.0)
                .max_by(|a, b| a.1.total_cmp(&b.1))
                .map(|(d, _)| d)
        })
}

fn contains(bounds: &Rect, x: f64, y: f64) -> bool {
    x >= bounds.x && x < bounds.x + bounds.width && y >= bounds.y && y < bounds.y + bounds.height
}

fn overlap(a: &Rect, b: &Rect) -> f64 {
    let w = (a.x + a.width).min(b.x + b.width) - a.x.max(b.x);
    let h = (a.y + a.height).min(b.y + b.height) - a.y.max(b.y);
    if w > 0.0 && h > 0.0 { w * h } else { 0.0 }
}
