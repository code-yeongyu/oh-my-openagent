//! A renderer's view of the latest admitted cursor intent for one open generation.

use std::sync::Arc;

use arc_swap::ArcSwapOption;
use omo_computer_core::params::Point;

use super::look::Action;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum CursorPlacement {
    /// An admitted point in the desktop coordinate space used by the input route.
    Aim(Point),
    /// Change the badge without starting a glide. `None` means no mark is positioned yet.
    BadgeOnly(Option<Point>),
}

/// An intent, not a delivery receipt. It never carries the contents of an action.
#[derive(Debug, Clone, PartialEq)]
pub struct CursorReport {
    pub colour: &'static str,
    pub badge: Action,
    pub placement: CursorPlacement,
}

/// A reader for one generation. Poll on the renderer's clock, not the dispatcher's.
#[derive(Clone)]
pub struct CursorReports(Arc<ArcSwapOption<CursorReport>>);

impl CursorReports {
    /// A retained snapshot holds no lock and cannot delay the next offer.
    #[must_use]
    pub fn latest(&self) -> Option<Arc<CursorReport>> {
        self.0.load_full()
    }
}

pub(crate) struct Publisher {
    reader: CursorReports,
    colour: &'static str,
    point: Option<Point>,
}

impl Publisher {
    pub(crate) fn new(colour: &'static str) -> Self {
        Self {
            reader: CursorReports(Arc::new(ArcSwapOption::empty())),
            colour,
            point: None,
        }
    }

    #[must_use]
    pub(crate) fn reader(&self) -> CursorReports {
        self.reader.clone()
    }

    pub(crate) fn offer(&mut self, badge: Action, aim: Option<Point>) {
        let placement = match aim {
            Some(point) => {
                self.point = Some(point);
                CursorPlacement::Aim(point)
            }
            None => CursorPlacement::BadgeOnly(self.point),
        };
        self.reader.0.store(Some(Arc::new(CursorReport {
            colour: self.colour,
            badge,
            placement,
        })));
    }
}

impl Drop for Publisher {
    fn drop(&mut self) {
        self.reader.0.store(None);
    }
}
