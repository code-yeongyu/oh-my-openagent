//! The native window that owns an element's frame on a host whose window
//! ids AT-SPI cannot name (X11 XIDs). AT-SPI exposes no window handle to
//! join on, so the frame is joined to a window by its application's pid
//! (`_NET_WM_PID`), then told apart from the pid's other windows by exact
//! title and frame geometry, which must agree. Anything short of one
//! provable window is unknown: never the topmost window at the element.

use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::types::DesktopWindow;

use crate::apps::{bounds_distance, frames};
use crate::bus::{AtSpiBus, Extents};

/// Largest edge-distance sum between a frame and its window, covering
/// window-manager decorations and client-side shadows (cua's
/// `FRAME_MATCH_TOLERANCE_PX`).
const FRAME_MATCH_TOLERANCE: u64 = 160;
/// How much closer the best window must be than the next one (cua's
/// `FRAME_MATCH_MARGIN_PX`); a closer runner-up is a tie, not a match.
const FRAME_MATCH_MARGIN: u64 = 24;

/// What the accessibility bus says about an element's frame.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FrameFacts {
    /// The pid of the frame's application's bus connection.
    pub(crate) pid: Option<u32>,
    /// The frame's accessible name, which toolkits set to the window title.
    pub(crate) title: String,
    /// The frame's screen extents, when it implements Component.
    pub(crate) extents: Option<Extents>,
    /// Whether the frame is its application's only top-level frame.
    pub(crate) sole_frame: bool,
}

/// Reads `frame`'s facts from the bus and names its window in `windows`.
pub(crate) fn native_owner<B: AtSpiBus>(
    bus: &mut B,
    frame: &B::Node,
    windows: &[DesktopWindow],
) -> CoreResult<Option<String>> {
    let app = bus.parent(frame).map_err(DesktopError::ax_failed)?;
    let facts = FrameFacts {
        pid: bus.process_id(&app),
        title: bus.name(frame).unwrap_or_default(),
        extents: bus.extents(frame).ok(),
        sole_frame: frames(bus, &app).is_ok_and(|frames| frames.len() == 1),
    };
    Ok(correlate_owner(&facts, windows))
}

/// The one window of the frame's pid that the frame provably is:
///
/// - the geometry winner (within tolerance, clear of the runner-up by the
///   margin), unless another window of the pid carries the frame's exact
///   title while the winner does not;
/// - otherwise the only window of the pid with the exact title that
///   geometry does not rule out;
/// - otherwise, with no usable extents or title, the pid's only window when
///   the frame is its application's only frame.
///
/// `None` when the pid is unknown or unlisted, the pid's windows cannot be
/// told apart, or title and geometry disagree.
pub(crate) fn correlate_owner(frame: &FrameFacts, windows: &[DesktopWindow]) -> Option<String> {
    let pid = frame.pid?;
    let candidates: Vec<&DesktopWindow> = windows.iter().filter(|win| win.pid == Some(pid)).collect();
    let extents = frame.extents.filter(|&extents| trusted(extents));
    let titled: Vec<&DesktopWindow> = candidates
        .iter()
        .copied()
        .filter(|win| !frame.title.is_empty() && win.title == frame.title)
        .collect();
    if let Some(winner) = extents.and_then(|extents| geometry_winner(extents, &candidates)) {
        let disagrees = !titled.is_empty() && !titled.iter().any(|win| win.id == winner.id);
        return (!disagrees).then(|| winner.id.clone());
    }
    let near = |win: &&DesktopWindow| {
        extents.is_none_or(|extents| bounds_distance(extents, win) <= FRAME_MATCH_TOLERANCE)
    };
    match titled.into_iter().filter(near).collect::<Vec<_>>().as_slice() {
        [only] => return Some(only.id.clone()),
        [_, _, ..] => return None,
        [] => {}
    }
    match candidates.as_slice() {
        [only] if frame.sole_frame && extents.is_none() && (frame.title.is_empty() || only.title.is_empty()) => {
            Some(only.id.clone())
        }
        _ => None,
    }
}

/// The candidate nearest `extents`, when it is within tolerance and clear
/// of the runner-up by the margin.
fn geometry_winner<'w>(extents: Extents, candidates: &[&'w DesktopWindow]) -> Option<&'w DesktopWindow> {
    let mut ranked: Vec<(u64, &DesktopWindow)> = candidates
        .iter()
        .map(|&win| (bounds_distance(extents, win), win))
        .collect();
    ranked.sort_by_key(|&(distance, _)| distance);
    match ranked.as_slice() {
        [(best, win), rest @ ..]
            if *best <= FRAME_MATCH_TOLERANCE
                && rest
                    .first()
                    .is_none_or(|(next, _)| next - best >= FRAME_MATCH_MARGIN) =>
        {
            Some(*win)
        }
        _ => None,
    }
}

/// Extents that locate a frame on screen: non-empty and not collapsed to
/// the origin, where GTK4 on X11 reports every frame (cua refuses them too).
fn trusted(extents: Extents) -> bool {
    extents.width > 0 && extents.height > 0 && (extents.x, extents.y) != (0, 0)
}
