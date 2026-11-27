//! The own window enumerator (design row M1): one `CGWindowListCopyWindowInfo` listing
//! reconciled with AX, identity `{windowNumber, pid, processStart}` from one `proc_pidinfo` per
//! pid per listing, and `truncated` instead of a hard cap: a window past the cut is still
//! reachable by its id.

use std::collections::BTreeMap;

use omo_computer_core::backend::{BackendResult, Refusal, WindowFilter, WindowList};
use omo_computer_core::listing::{WindowIdentity, WindowInfo};
use omo_computer_core::untrusted::UntrustedText;

use super::seam::CaptureOs;
use super::types::{AxWindowFacts, CgWindow, DisplayRecord};
use crate::displays::display_of;

/// The most records one `windows()` reply carries; more set `truncated`.
pub const MAX_LISTED: usize = 50;

/// One listed window with what capture needs of it.
#[derive(Debug, Clone, PartialEq)]
pub struct Listed {
    pub info: WindowInfo,
    pub minimized: bool,
}

/// Every eligible window of one fresh listing, front to back. The process-start cache lives
/// for this one listing only, so a reused pid never inherits an old start time.
///
/// # Errors
/// The window server answered no list.
pub fn listing(os: &mut dyn CaptureOs, own_pid: u32) -> BackendResult<Vec<Listed>> {
    let windows = os.window_list()?;
    let scene = Scene {
        displays: os.displays()?,
        frontmost: os.frontmost_pid(),
    };
    let mut starts: BTreeMap<u32, Option<u64>> = BTreeMap::new();
    let mut listed = Vec::new();
    for window in windows.iter().filter(|w| eligible(w, own_pid)) {
        let start = *starts
            .entry(window.pid)
            .or_insert_with(|| os.process_start(window.pid));
        // The process exited between the list and the read: no identity, no record.
        let Some(process_start) = start.filter(|s| *s > 0) else {
            continue;
        };
        let ax = os.ax_window(window).unwrap_or_default();
        let app_key = os
            .bundle_id(window.pid)
            .unwrap_or_else(|| window.owner.clone());
        let space = os.space_of(window.number);
        let z = u32::try_from(listed.len()).unwrap_or(u32::MAX);
        let info = record(window, process_start, &ax, app_key, space, &scene, z);
        listed.push(Listed {
            info,
            minimized: ax.minimized,
        });
    }
    Ok(listed)
}

/// `windows()`: the filtered listing cut at [`MAX_LISTED`].
///
/// # Errors
/// The window server answered no list.
pub fn list(
    os: &mut dyn CaptureOs,
    own_pid: u32,
    filter: &WindowFilter,
) -> BackendResult<WindowList> {
    let matching: Vec<WindowInfo> = listing(os, own_pid)?
        .into_iter()
        .map(|l| l.info)
        .filter(|w| matches(filter, w))
        .collect();
    let truncated = matching.len() > MAX_LISTED;
    Ok(WindowList {
        windows: matching.into_iter().take(MAX_LISTED).collect(),
        truncated,
    })
}

/// The listed window behind `id`, ignoring the cut.
///
/// # Errors
/// `WindowNotFound` for an id that is no listed window.
pub fn find(os: &mut dyn CaptureOs, own_pid: u32, id: &str) -> BackendResult<Listed> {
    let not_found = Refusal::bare(omo_computer_core::error::EngineCode::WindowNotFound);
    let number: u32 = id.parse().map_err(|_| not_found.clone())?;
    listing(os, own_pid)?
        .into_iter()
        .find(|l| l.info.identity.window_number == Some(u64::from(number)))
        .ok_or(not_found)
}

/// The engine's own windows (overlay, receipt) that are on screen: every still excludes them.
///
/// # Errors
/// The window server answered no list.
pub fn own_on_screen(os: &mut dyn CaptureOs, own_pid: u32) -> BackendResult<Vec<u32>> {
    Ok(os
        .window_list()?
        .into_iter()
        .filter(|w| w.pid == own_pid && w.on_screen)
        .map(|w| w.number)
        .collect())
}

/// What one listing reads once for all its windows.
struct Scene {
    displays: Vec<DisplayRecord>,
    frontmost: Option<u32>,
}

fn eligible(window: &CgWindow, own_pid: u32) -> bool {
    window.layer == 0
        && window.pid != own_pid
        && window.bounds.width > 0.0
        && window.bounds.height > 0.0
}

fn matches(filter: &WindowFilter, window: &WindowInfo) -> bool {
    filter
        .app
        .as_ref()
        .is_none_or(|app| &window.app == app || &window.app_key == app)
        && filter
            .title
            .as_ref()
            .is_none_or(|title| window.title.contains(title.as_str()))
        && filter.pid.is_none_or(|pid| window.identity.pid == pid)
}

fn record(
    window: &CgWindow,
    process_start: u64,
    ax: &AxWindowFacts,
    app_key: String,
    space: Option<String>,
    scene: &Scene,
    z: u32,
) -> WindowInfo {
    let title = match (&ax.title, window.title.is_empty()) {
        (Some(title), true) => title.clone(),
        _ => window.title.clone(),
    };
    WindowInfo {
        id: window.number.to_string(),
        identity: WindowIdentity {
            window_number: Some(u64::from(window.number)),
            hwnd: None,
            xid: None,
            pid: window.pid,
            process_start,
        },
        app: window.owner.clone(),
        app_key,
        title,
        bounds: window.bounds,
        display: display_of(&scene.displays, &window.bounds)
            .map(|d| d.id.to_string())
            .unwrap_or_default(),
        // Every running app has a focused window; only the frontmost app's one is focused.
        focused: ax.focused_in_app && scene.frontmost == Some(window.pid),
        is_on_screen: window.on_screen,
        space,
        minimized: ax.minimized,
        elevated: false,
        z,
        observation: UntrustedText,
    }
}
