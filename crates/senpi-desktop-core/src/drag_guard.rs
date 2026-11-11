//! Guarding a background left-button drag or mouse hold against a
//! drag-and-drop session. Ported from oh-my-pi 0838d2ab44 `macos/input.rs`
//! (`refuse_drag_source`, `stroke_path`, `drag_session_outcome`); the
//! platform reads (the start point's accessibility role, the drag
//! pasteboard's change count) and posts come in as closures, so the macOS
//! backend and the fake backend share one guard.
//!
//! A press on an item (a file, a row, an image, selected text) can begin a
//! drag-and-drop session, which macOS completes from the user's real pointer
//! as well as from the routed events: on macOS 26.5 a Finder file followed a
//! user's moving pointer into their own Finder window and onto the Desktop,
//! and going back to the start once the session began did not keep it out
//! (1 in 2 on an 11-point path). Which elements begin such a session is up to
//! each application, so only the known trackers are let through.

use crate::error::{CoreResult, DesktopError};
use crate::types::DesktopWindow;

/// Roles of controls that track a left-button drag themselves and never begin
/// a drag-and-drop session.
pub const DRAG_TRACKING_ROLES: [&str; 5] = [
    "AXSlider",
    "AXScrollBar",
    "AXSplitter",
    "AXValueIndicator",
    "AXIncrementor",
];

/// A background gesture that presses the left button at `start` on `window`,
/// as errors name it (`kind`: "drag" or "mouse hold").
#[derive(Clone, Copy, Debug)]
pub struct LeftPress<'a> {
    pub kind: &'a str,
    pub window: &'a DesktopWindow,
    pub start: (f64, f64),
}

/// Refuses `press` before anything is posted, unless the element at its start
/// point (`role_at`) tracks the drag itself ([`DRAG_TRACKING_ROLES`]). An
/// unreadable role is refused too. The refusal is `BackgroundUnavailable`:
/// nothing was sent, so the host may rerun the gesture in the foreground
/// where the session already allows it.
///
/// What accessibility says is under a press's start point, read through the
/// application's own tree.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StartPoint {
    /// The role of the target window's element there.
    Role(String),
    /// Nothing readable there.
    Unread,
    /// The element there belongs to another window of the same application,
    /// which covers the start point: it says nothing about the target window,
    /// where the press is routed.
    Covered,
}

/// # Errors
/// `BackgroundUnavailable` naming the role and the window.
pub fn refuse_drag_source(
    press: LeftPress<'_>,
    start_point: impl FnOnce(f64, f64) -> StartPoint,
) -> CoreResult<()> {
    let (x, y) = press.start;
    let element = match start_point(x, y) {
        StartPoint::Role(role) if DRAG_TRACKING_ROLES.contains(&role.as_str()) => return Ok(()),
        StartPoint::Role(role) => format!("an {role}"),
        StartPoint::Unread => "an element accessibility does not identify".to_string(),
        StartPoint::Covered => {
            "an element of another window of the application, which covers the start point"
                .to_string()
        }
    };
    Err(DesktopError::background_unavailable(format!(
        "the {} on window {} ({}) starts on {element}, where a press can pick up an item for drag and drop, \
         which macOS completes from the user's real pointer and could drop into the user's own window; \
         background drags and holds run only on sliders, scroll bars, splitters and steppers; nothing was sent",
        press.kind, press.window.id, press.window.app,
    )))
}

/// One event of a background drag.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stroke {
    Down,
    Dragged,
    Up,
}

/// Posts a drag along `path` (at least two points): the press at its start,
/// one dragged event per later point, and the release; returns whether the
/// drag picked up an item. The release is posted whatever happens before it,
/// at the last point attempted, since a failed post may still have been
/// delivered. Before each later point, `picked_up` says whether the source
/// has begun a drag-and-drop session (it is the caller's step gap too, so the
/// source has handled the previous event before the pasteboard is read); the
/// stroke then goes no further, but back to its start, and is released there
/// ([`drag_session_outcome`]).
///
/// # Errors
/// The first failed post, after the release was attempted.
pub fn stroke_path(
    path: &[(f64, f64)],
    mut picked_up: impl FnMut() -> bool,
    mut post: impl FnMut(Stroke, (f64, f64)) -> CoreResult<()>,
) -> CoreResult<bool> {
    let Some(&start) = path.first() else {
        return Err(DesktopError::input_failed(
            "drag path must contain at least two points",
        ));
    };
    let mut last = start;
    let mut session = false;
    let mut stroke = || -> CoreResult<()> {
        post(Stroke::Down, last)?;
        for &at in &path[1..] {
            if picked_up() {
                session = true;
                return Ok(());
            }
            last = at;
            post(Stroke::Dragged, at)?;
        }
        Ok(())
    };
    let result = stroke();
    let back = if session && last != start {
        last = start;
        post(Stroke::Dragged, last)
    } else {
        Ok(())
    };
    let release = post(Stroke::Up, last);
    result.and(back).and(release).map(|()| session)
}

/// [`stroke_path`]'s error for a drag whose source began a drag-and-drop
/// session during the stroke: the stroke stopped as soon as the session began
/// and was released where it started, over the item's own place, so the item
/// drops back on its source rather than wherever the user's pointer is.
pub fn picked_up_refusal(window: &DesktopWindow) -> DesktopError {
    DesktopError::input_failed(format!(
        "the drag reached window {} ({}) and picked up an item for drag and drop, which macOS completes from \
         the user's real pointer, so it was taken back to where it started and released there instead of \
         being carried along the path. Read the target before retrying: the press and the start of the drag \
         were delivered. Move the item with the app's menu command or ax actions",
        window.id, window.app,
    ))
}

/// The verdict after a drag's release, from the drag pasteboard's change
/// count as `count` reads it and as it was `before` the press. A source
/// writes the pasteboard while it handles the routed events; when the count
/// has not moved yet, `caught_up` waits until the target has handled them
/// (an accessibility round trip), and the count is read once more. A drag
/// that started a session has an unknown outcome rather than a failed one:
/// the item may have dropped at the path's end, elsewhere, or nowhere.
///
/// # Errors
/// `InputFailed` saying the drop could not be confirmed.
pub fn drag_session_outcome(
    window: &DesktopWindow,
    before: isize,
    mut count: impl FnMut() -> isize,
    caught_up: impl FnOnce(),
) -> CoreResult<()> {
    if count() == before {
        caught_up();
        if count() == before {
            return Ok(());
        }
    }
    Err(DesktopError::input_failed(format!(
        "the drag reached window {} ({}), but its outcome could not be confirmed: it started a drag-and-drop \
         session, which macOS completes from the user's real pointer and button, so the item may already have \
         been dropped at the path's end, elsewhere, or not at all. Read the target before retrying, and prefer \
         the app's menu command or ax actions",
        window.id, window.app,
    )))
}

#[cfg(test)]
mod tests;
