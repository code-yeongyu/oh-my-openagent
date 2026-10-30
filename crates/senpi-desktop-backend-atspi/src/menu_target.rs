//! Binds a menu request to the exact window it names. A frame picked by
//! title or geometry could be a sibling window of the same application, so
//! exactly one accessible frame must provably be the requested window,
//! before any discovery and again before the action.

use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::types::DesktopWindow;

use crate::apps::{frames, is_top_level};
use crate::bus::AtSpiBus;
use crate::owner::native_owner;
use crate::WindowIds;

/// The window a menu request names, in the host backend's id space, with
/// the backend's window list for native correlation.
#[derive(Clone, Copy)]
pub(crate) struct MenuTarget<'a> {
    pub(crate) window: &'a DesktopWindow,
    pub(crate) ids: WindowIds,
    pub(crate) windows: &'a [DesktopWindow],
}

fn unbound(window: &DesktopWindow) -> DesktopError {
    DesktopError::ax_failed(format!(
        "AT-SPI menu: no single accessible frame is provably window {}; no command was dispatched",
        window.id
    ))
}

/// The one frame that is `target.window`, refusing unless exactly one frame
/// provably is.
pub(crate) fn bound_root<B: AtSpiBus>(bus: &mut B, target: MenuTarget<'_>) -> CoreResult<B::Node> {
    let matches = match target.ids {
        WindowIds::AtSpiFrames => by_object_id(bus, target.window)?,
        WindowIds::Native => by_native_owner(bus, target)?,
    };
    match <[B::Node; 1]>::try_from(matches) {
        Ok([frame]) => Ok(frame),
        Err(_) => Err(unbound(target.window)),
    }
}

/// Frames carrying the window's object id. The id includes the owning
/// application's bus name, so an application that cannot be read cannot hold
/// it and is skipped rather than failing every request.
fn by_object_id<B: AtSpiBus>(bus: &mut B, window: &DesktopWindow) -> CoreResult<Vec<B::Node>> {
    let mut matches = Vec::new();
    for app in bus.applications().map_err(DesktopError::ax_failed)? {
        let Ok(app_frames) = frames(bus, &app) else {
            continue;
        };
        matches.extend(app_frames.into_iter().filter(|frame| bus.object_id(frame) == window.id));
    }
    Ok(matches)
}

fn unreadable(error: impl std::fmt::Display) -> DesktopError {
    DesktopError::ax_failed(format!(
        "AT-SPI menu: a frame of the target's process cannot be read ({error}); no command was dispatched"
    ))
}

/// The frames of `app`, refusing when any child's role cannot be read.
fn frames_strictly<B: AtSpiBus>(bus: &mut B, app: &B::Node) -> CoreResult<Vec<B::Node>> {
    let mut found = Vec::new();
    for child in bus.children(app).map_err(unreadable)? {
        if is_top_level(bus.role(&child).map_err(unreadable)?) {
            found.push(child);
        }
    }
    Ok(found)
}

/// Frames of the listed window's process whose correlated owner is the window.
/// Every frame of that process is read and any read error refuses: an
/// unreadable frame might be the window, which would leave a same-titled
/// sibling (a minimized one included) as a false sole match. A target frame
/// that is already gone is caught by the caller re-reading the window list.
fn by_native_owner<B: AtSpiBus>(bus: &mut B, target: MenuTarget<'_>) -> CoreResult<Vec<B::Node>> {
    let pid = target
        .windows
        .iter()
        .find(|listed| listed.id == target.window.id)
        .and_then(|listed| listed.pid)
        .ok_or_else(|| unbound(target.window))?;
    let mut matches = Vec::new();
    for app in bus.applications().map_err(DesktopError::ax_failed)? {
        if bus.process_id(&app) != Some(pid) {
            continue;
        }
        for frame in frames_strictly(bus, &app)? {
            if native_owner(bus, &frame, target.windows).map_err(unreadable)?.as_deref() == Some(target.window.id.as_str()) {
                matches.push(frame);
            }
        }
    }
    Ok(matches)
}
