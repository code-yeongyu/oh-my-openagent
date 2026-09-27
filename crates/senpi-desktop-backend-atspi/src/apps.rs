//! Applications and their top-level frames: window enumeration, the frame a
//! `DesktopWindow` maps to, hit-testing, and the focused element.

use std::cmp::Reverse;

use atspi::{Role, State};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::types::DesktopWindow;

use crate::bus::{AtSpiBus, BusResult, Extents, ScreenPoint};

/// Enumeration cap, matching oh-my-pi's window list.
const MAX_WINDOWS: usize = 48;
/// Frames smaller than this on either edge are tooltips and popups.
const MIN_WINDOW_EDGE: i32 = 16;
/// Depth guard for the focused-element search.
const MAX_FOCUS_DEPTH: u8 = 40;

/// Every top-level frame of every registered application, in registry order.
pub(crate) fn windows<B: AtSpiBus>(bus: &mut B) -> CoreResult<Vec<DesktopWindow>> {
    let mut windows = Vec::new();
    for app in bus.applications().map_err(DesktopError::ax_failed)? {
        let app_name = bus.name(&app).unwrap_or_default();
        let pid = bus.process_id(&app);
        for frame in frames(bus, &app).unwrap_or_default() {
            let Ok(extents) = bus.extents(&frame) else {
                continue;
            };
            if extents.width < MIN_WINDOW_EDGE || extents.height < MIN_WINDOW_EDGE {
                continue;
            }
            let focused = bus
                .state(&frame)
                .is_ok_and(|states| states.contains(State::Focused) || states.contains(State::Active));
            windows.push(DesktopWindow {
                id: bus.object_id(&frame),
                title: bus.name(&frame).unwrap_or_default(),
                app: app_name.clone(),
                pid,
                x: extents.x,
                y: extents.y,
                width: extents.width.unsigned_abs(),
                height: extents.height.unsigned_abs(),
                focused,
                elevated: None,
            });
            if windows.len() == MAX_WINDOWS {
                return Ok(windows);
            }
        }
    }
    Ok(windows)
}

/// The children of `app` that are frames, dialogs, or windows.
fn frames<B: AtSpiBus>(bus: &mut B, app: &B::Node) -> BusResult<Vec<B::Node>> {
    let children = bus.children(app)?;
    Ok(children
        .into_iter()
        .filter(|child| matches!(bus.role(child), Ok(Role::Frame | Role::Dialog | Role::Window)))
        .collect())
}

/// The application owning `win`: the one whose bus connection belongs to
/// `win.pid`, else the last one whose name matches the window's app or title.
fn app_for_window<B: AtSpiBus>(bus: &mut B, win: &DesktopWindow) -> BusResult<B::Node> {
    let mut name_match = None;
    for app in bus.applications()? {
        let name = bus.name(&app).unwrap_or_default();
        if name.eq_ignore_ascii_case(&win.app) || (!name.is_empty() && win.title.contains(&name)) {
            name_match = Some(app.clone());
        }
        if win.pid.is_some() && bus.process_id(&app) == win.pid {
            return Ok(app);
        }
    }
    name_match.ok_or_else(|| format!("application '{}' (pid {:?}) not found", win.app, win.pid))
}

/// Sum of edge differences between a frame's extents and the window's rect.
fn bounds_distance(extents: Extents, win: &DesktopWindow) -> u64 {
    let gap = |a: i64, b: i64| (a - b).unsigned_abs();
    gap(extents.x.into(), win.x.into())
        + gap(extents.y.into(), win.y.into())
        + gap(extents.width.into(), win.width.into())
        + gap(extents.height.into(), win.height.into())
}

/// The frame of `win`'s application that is `win`: a title match first, then
/// the nearest bounds, then registry order.
pub(crate) fn window_root<B: AtSpiBus>(bus: &mut B, win: &DesktopWindow) -> CoreResult<B::Node> {
    let pick = |bus: &mut B| -> BusResult<B::Node> {
        let app = app_for_window(bus, win)?;
        frames(bus, &app)?
            .into_iter()
            .min_by_key(|frame| {
                let title_matches = bus.name(frame).is_ok_and(|title| title == win.title);
                let distance = bus
                    .extents(frame)
                    .map_or(u64::MAX, |extents| bounds_distance(extents, win));
                (Reverse(title_matches), distance)
            })
            .ok_or_else(|| format!("no frame or dialog found for '{}'", win.title))
    };
    pick(bus).map_err(|err| DesktopError::ax_failed(format!("AT-SPI window root: {err}")))
}

/// Rounds a global logical coordinate to the nearest screen pixel.
fn screen_coordinate(value: f64) -> i32 {
    // Clamped into i32 range first, so the cast is exact.
    value.round().clamp(f64::from(i32::MIN), f64::from(i32::MAX)) as i32
}

/// The deepest element under a global point, searched frame by frame.
pub(crate) fn element_at<B: AtSpiBus>(bus: &mut B, x: f64, y: f64) -> CoreResult<Option<B::Node>> {
    let point = ScreenPoint {
        x: screen_coordinate(x),
        y: screen_coordinate(y),
    };
    for app in bus.applications().map_err(DesktopError::ax_failed)? {
        for frame in frames(bus, &app).unwrap_or_default() {
            if !bus.contains(&frame, point).unwrap_or(false) {
                continue;
            }
            let found = bus
                .accessible_at_point(&frame, point)
                .map_err(DesktopError::ax_failed)?;
            return Ok((!bus.is_null(&found)).then_some(found));
        }
    }
    Ok(None)
}

/// The first element in depth-first order whose state holds `Focused`.
pub(crate) fn focused_element<B: AtSpiBus>(bus: &mut B) -> CoreResult<Option<B::Node>> {
    for app in bus.applications().map_err(DesktopError::ax_failed)? {
        if let Some(found) = find_focused(bus, app, 0) {
            return Ok(Some(found));
        }
    }
    Ok(None)
}

fn find_focused<B: AtSpiBus>(bus: &mut B, node: B::Node, depth: u8) -> Option<B::Node> {
    if depth > MAX_FOCUS_DEPTH {
        return None;
    }
    if bus
        .state(&node)
        .is_ok_and(|states| states.contains(State::Focused))
    {
        return Some(node);
    }
    bus.children(&node)
        .unwrap_or_default()
        .into_iter()
        .find_map(|child| find_focused(bus, child, depth + 1))
}
