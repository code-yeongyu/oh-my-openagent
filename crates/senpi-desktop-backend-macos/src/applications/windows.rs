//! The windows an application shows, as `apps.open` reads them: Quartz's
//! list intersected with the accessibility windows, so Chromium, Electron and
//! WebKit compositor surfaces (which refuse keys and misplace clicks) are
//! never returned as the opened window.

use senpi_desktop_core::types::DesktopWindow;

use crate::ax::element;
use crate::capture;
use crate::focus;

/// `pid`'s listed windows, front to back, that can be key. `None` without a
/// window list.
pub(super) fn key_capable_windows(pid: u32) -> Option<Vec<DesktopWindow>> {
    let windows: Vec<DesktopWindow> = capture::windows::enumerate()
        .ok()?
        .into_iter()
        .filter(|window| window.pid == Some(pid))
        .collect();
    let ax_ids = libc::pid_t::try_from(pid).ok().and_then(ax_window_ids);
    Some(in_ax_windows(windows, ax_ids.as_deref()))
}

/// The `windows` among the application's accessibility windows (`ax_ids`);
/// all of them when those cannot be read, which proves nothing either way.
pub(super) fn in_ax_windows(mut windows: Vec<DesktopWindow>, ax_ids: Option<&[u32]>) -> Vec<DesktopWindow> {
    if let Some(ids) = ax_ids {
        windows.retain(|window| window.id.parse::<u32>().is_ok_and(|id| ids.contains(&id)));
    }
    windows
}

struct WindowRecord {
    id: Option<u32>,
    minimized: Option<bool>,
}

fn window_records(pid: libc::pid_t) -> Option<Vec<WindowRecord>> {
    let app = element::create_application(pid).ok()?;
    element::set_timeout(&app).ok()?;
    Some(
        element::copy_elements(&app, "AXWindows")?
            .iter()
            .map(|window| WindowRecord {
                id: element::window_id(window),
                minimized: element::copy_bool(window, "AXMinimized"),
            })
            .collect(),
    )
}

/// Whether `pid` has a window among its `AXWindows` that is not minimized:
/// one that unhiding the application shows. `None` when nothing can be read.
pub(super) fn has_open_window(pid: libc::pid_t) -> Option<bool> {
    let records = window_records(pid)?;
    Some(records.iter().any(|record| record.id.is_some() && record.minimized != Some(true)))
}

/// The window ids of `pid`'s `AXWindows`. `None` when nothing can be read.
pub(super) fn ax_window_ids(pid: libc::pid_t) -> Option<Vec<u32>> {
    Some(window_records(pid)?.into_iter().filter_map(|record| record.id).collect())
}

/// Whether `pid` owns an on-screen window in the normal layer; owner and
/// layer need no Screen Recording permission. `None` when the list cannot be
/// read.
pub(super) fn has_onscreen_window(pid: libc::pid_t) -> Option<bool> {
    let pid = u32::try_from(pid).ok()?;
    let windows = focus::window_info().ok()?;
    Some(windows.iter().any(|window| window.pid == pid && window.layer == 0 && window.on_screen))
}
