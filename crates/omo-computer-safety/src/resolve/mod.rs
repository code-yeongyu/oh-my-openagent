//! The effective target of a call, from the window listing: a pointer verb resolves the
//! topmost window under each point, a keyboard verb the focused window, a window target its
//! own window for points inside its frame (a point outside it resolves as a desktop verb does).
//! An unreadable listing resolves every point `Unreadable`, which the gate refuses.

use omo_computer_core::listing::WindowInfo;
use omo_computer_core::params::Point;

use crate::gate::{Identity, PointTarget, Resolution, VerbKind};

/// What the call names as its target.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TargetRef<'a> {
    Desktop,
    Window(&'a str),
}

impl<'a> TargetRef<'a> {
    /// `None` and `"desktop"` name the desktop; anything else a window id.
    #[must_use]
    pub fn read(target: Option<&'a str>) -> Self {
        match target {
            None | Some("desktop") => Self::Desktop,
            Some(id) => Self::Window(id),
        }
    }
}

fn identity(window: &WindowInfo) -> Resolution {
    Resolution::Window(Identity {
        pid: window.identity.pid,
        app_key: window.app_key.clone(),
        surface: None,
    })
}

fn contains(window: &WindowInfo, x: f64, y: f64) -> bool {
    let b = &window.bounds;
    x >= b.x && y >= b.y && x < b.x + b.width && y < b.y + b.height
}

/// The topmost window containing the screen point, else the desktop.
fn under(windows: &[WindowInfo], x: f64, y: f64) -> Resolution {
    windows
        .iter()
        .filter(|window| !window.minimized && contains(window, x, y))
        .min_by_key(|window| window.z)
        .map_or(Resolution::Desktop, identity)
}

/// One resolved target per point (one for a keyboard verb or a call without points).
#[must_use]
pub fn resolve(
    windows: Option<&[WindowInfo]>,
    target: TargetRef<'_>,
    verb: VerbKind,
    points: &[Point],
) -> Vec<PointTarget> {
    let Some(windows) = windows else {
        return unreadable(points);
    };
    match target {
        TargetRef::Window(id) => match windows.iter().find(|window| window.id == id) {
            None => unreadable(points),
            Some(window) if verb == VerbKind::Keyboard || points.len() <= 1 => {
                vec![PointTarget::new(points.first().copied(), identity(window))]
            }
            Some(window) => points
                .iter()
                .map(|point| {
                    let inside = point.x >= 0.0
                        && point.y >= 0.0
                        && point.x < window.bounds.width
                        && point.y < window.bounds.height;
                    let resolution = if inside {
                        identity(window)
                    } else {
                        under(
                            windows,
                            window.bounds.x + point.x,
                            window.bounds.y + point.y,
                        )
                    };
                    PointTarget::new(Some(*point), resolution)
                })
                .collect(),
        },
        TargetRef::Desktop if verb == VerbKind::Keyboard => {
            let focused = windows.iter().find(|window| window.focused);
            vec![PointTarget::new(
                None,
                focused.map_or(Resolution::Unreadable, identity),
            )]
        }
        TargetRef::Desktop => points
            .iter()
            .map(|point| PointTarget::new(Some(*point), under(windows, point.x, point.y)))
            .collect(),
    }
}

fn unreadable(points: &[Point]) -> Vec<PointTarget> {
    if points.is_empty() {
        return vec![PointTarget::new(None, Resolution::Unreadable)];
    }
    points
        .iter()
        .map(|point| PointTarget::new(Some(*point), Resolution::Unreadable))
        .collect()
}

#[cfg(test)]
mod tests;
