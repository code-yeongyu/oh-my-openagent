//! Which window owns the frontmost surface at a point, and the foreground
//! pointer guard built on it: HID input goes to whatever is frontmost at the
//! point, so a raised, key target that another window still covers there
//! would hand the input to the covering window (#9079).

use std::ptr::NonNull;
use std::thread;
use std::time::{Duration, Instant};

use objc2_application_services::AXError;
use senpi_desktop_core::backend::PointerEvent;
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::types::DesktopWindow;

use super::{actions, element, tree};

/// How long a re-raised target may take to come out from under a cover.
const UNCOVER_DEADLINE: Duration = Duration::from_millis(500);
const UNCOVER_POLL: Duration = Duration::from_millis(20);

/// The process and window of the frontmost surface at a point.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct PointOwner {
    pub(crate) pid: libc::pid_t,
    pub(crate) window: Option<u32>,
}

/// What stands at one of the action's points.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Coverage {
    /// The target window itself.
    Target,
    /// Another window (another process, or another window of the same one).
    Covered(PointOwner),
    /// Nothing identifiable: no hit-test result or no window behind it. That
    /// is not evidence that the input would reach the target.
    Unknown,
}

pub(crate) fn coverage(owner: Option<PointOwner>, pid: libc::pid_t, wid: u32) -> Coverage {
    match owner {
        Some(PointOwner { window: None, .. }) | None => Coverage::Unknown,
        Some(owner) if owner.pid == pid && owner.window == Some(wid) => Coverage::Target,
        Some(owner) => Coverage::Covered(owner),
    }
}

/// The points a pointer event hits first and last.
pub(crate) fn event_points(event: &PointerEvent) -> Vec<(f64, f64)> {
    match event {
        PointerEvent::Click { x, y, .. } | PointerEvent::Move { x, y } | PointerEvent::Scroll { x, y, .. } => {
            vec![(*x, *y)]
        }
        PointerEvent::Drag { path, .. } => path.first().into_iter().chain(path.last()).copied().collect(),
    }
}

/// Hit-tests `(x, y)` the way the pointer would.
fn point_owner(x: f64, y: f64) -> CoreResult<Option<PointOwner>> {
    let Some(hit) = tree::element_at(x, y)? else {
        return Ok(None);
    };
    let mut pid: libc::pid_t = 0;
    // SAFETY: `pid` is writable and the retained element outlives the call.
    if unsafe { hit.pid(NonNull::from(&mut pid)) } != AXError::Success || pid <= 0 {
        return Ok(None);
    }
    let window = if element::copy_string(&hit, "AXRole").as_deref() == Some("AXWindow") {
        element::window_id(&hit)
    } else {
        element::copy_element(&hit, "AXWindow").and_then(|window| element::window_id(&window))
    };
    Ok(Some(PointOwner { pid, window }))
}

/// Makes sure every point of a foreground pointer `event` lands on `window`:
/// re-raises it once if something covers a point, and refuses before any
/// input when a point stays covered or its owner cannot be identified.
///
/// # Errors
/// `InputFailed` naming the point and what covers it; nothing was posted.
pub(crate) fn ensure_points_owned(
    window: &DesktopWindow,
    pid: libc::pid_t,
    wid: u32,
    event: &PointerEvent,
) -> CoreResult<()> {
    let points = event_points(event);
    let first_problem = || -> CoreResult<Option<((f64, f64), Coverage)>> {
        for &(x, y) in &points {
            let found = coverage(point_owner(x, y)?, pid, wid);
            if found != Coverage::Target {
                return Ok(Some(((x, y), found)));
            }
        }
        Ok(None)
    };
    let Some(mut problem) = first_problem()? else {
        return Ok(());
    };
    if let Ok(root) = tree::window_root(window) {
        let _ = actions::perform(&root, "AXRaise");
    }
    let started = Instant::now();
    loop {
        match problem {
            ((x, y), Coverage::Unknown) => {
                return Err(DesktopError::input_failed(format!(
                    "cannot tell which window owns point ({x}, {y}) of window {wid}, so foreground \
                     input could land elsewhere; nothing was posted. Use delivery:\"background\" or \
                     ax actions"
                )));
            }
            ((x, y), Coverage::Covered(owner)) if started.elapsed() >= UNCOVER_DEADLINE => {
                let by = owner.window.map_or_else(String::new, |id| format!(" window {id} of"));
                return Err(DesktopError::input_failed(format!(
                    "point ({x}, {y}) of window {wid} is covered by{by} process {}, so foreground \
                     input would land there; nothing was posted. Move or close the covering window, \
                     or use delivery:\"background\" or ax actions",
                    owner.pid
                )));
            }
            _ => thread::sleep(UNCOVER_POLL),
        }
        match first_problem()? {
            None => return Ok(()),
            Some(next) => problem = next,
        }
    }
}

#[cfg(test)]
#[path = "point_owner_tests.rs"]
mod tests;
