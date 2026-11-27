//! grim capture: wlr-screencopy through the subprocess seam, per output for
//! displays and `-g` regions for windows, decoded from the PNG it writes to
//! stdout.

use image::{imageops, RgbaImage};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::types::{DesktopDisplay, DesktopWindow, DisplaySelector, Target};

use crate::command::CommandRunner;
use crate::ipc::{self, Rect, SwayIpc, SwayNode};

/// Proves screencopy works by capturing one pixel of the layout, so an
/// unreadable screen fails at session open (the X11 backend's 1x1
/// `GetImage` proof, on sway).
///
/// # Errors
/// `CaptureFailed` when grim cannot run or the compositor refuses.
pub fn probe(runner: &mut impl CommandRunner) -> CoreResult<()> {
    capture_region(
        runner,
        &Rect {
            x: 0,
            y: 0,
            width: 1,
            height: 1,
        },
    )
    .map(|_| ())
}

/// Captures `target`: the selector's displays composited at their pixel
/// offsets, or the window's compositor rect cropped out of the layout.
///
/// # Errors
/// `WindowNotFound` for an unknown window id; `CaptureFailed` when grim
/// cannot run or the compositor refuses.
pub fn capture(
    runner: &mut impl CommandRunner,
    ipc: &mut dyn SwayIpc,
    target: &Target,
    selector: &DisplaySelector,
) -> CoreResult<(RgbaImage, FrameGeometry)> {
    match target {
        Target::Desktop | Target::Display(_) => {
            let selector = target
                .display_selector()
                .unwrap_or_else(|| selector.clone());
            capture_desktop(runner, ipc, &selector)
        }
        Target::Window(id) => capture_window(runner, ipc, id),
    }
}

fn capture_png(runner: &mut impl CommandRunner, args: &[String]) -> CoreResult<RgbaImage> {
    let mut all = Vec::from(["-t".to_owned(), "png".to_owned()]);
    all.extend_from_slice(args);
    all.push("-".to_owned());
    let png = runner
        .run("grim", &all)
        .map_err(|failure| DesktopError::capture_failed(failure.message()))?;
    image::load_from_memory(&png)
        .map(|image| image.to_rgba8())
        .map_err(|error| DesktopError::capture_failed(format!("grim PNG output: {error}")))
}

fn capture_output(runner: &mut impl CommandRunner, name: &str) -> CoreResult<RgbaImage> {
    capture_png(runner, &["-o".to_owned(), name.to_owned()])
}

fn capture_region(runner: &mut impl CommandRunner, region: &Rect) -> CoreResult<RgbaImage> {
    capture_png(runner, &["-g".to_owned(), region.grim_geometry()])
}

fn capture_desktop(
    runner: &mut impl CommandRunner,
    ipc: &mut dyn SwayIpc,
    selector: &DisplaySelector,
) -> CoreResult<(RgbaImage, FrameGeometry)> {
    let displays = select_displays(ipc, selector)?;
    match displays.as_slice() {
        [] => Err(DesktopError::capture_failed(format!(
            "no active sway output matches the selector '{selector:?}'"
        ))),
        [one] => {
            let shot = capture_output(runner, &one.id)?;
            let mut display = one.clone();
            display.pixel_x = 0;
            display.pixel_y = 0;
            Ok((shot, FrameGeometry::for_displays(&[display])))
        }
        many => {
            let width = many
                .iter()
                .map(|display| display.pixel_x.saturating_add(display.pixel_width))
                .max()
                .unwrap_or(1);
            let height = many
                .iter()
                .map(|display| display.pixel_y.saturating_add(display.pixel_height))
                .max()
                .unwrap_or(1);
            let mut canvas = RgbaImage::from_pixel(width, height, image::Rgba([0, 0, 0, 255]));
            for display in many {
                let shot = capture_output(runner, &display.id)?;
                imageops::overlay(
                    &mut canvas,
                    &shot,
                    i64::from(display.pixel_x),
                    i64::from(display.pixel_y),
                );
            }
            Ok((canvas, FrameGeometry::for_displays(many)))
        }
    }
}

fn capture_window(
    runner: &mut impl CommandRunner,
    ipc: &mut dyn SwayIpc,
    id: &str,
) -> CoreResult<(RgbaImage, FrameGeometry)> {
    let tree = ipc::tree(ipc)?;
    let node = tree.find(id).ok_or_else(|| {
        DesktopError::window_not_found(format!("window {id} was not found in the sway tree"))
    })?;
    let shot = capture_region(runner, &node.rect)?;
    let window = sway_window(node);
    let (width, height) = (shot.width(), shot.height());
    Ok((shot, FrameGeometry::for_window(&window, width, height)))
}

/// The selector's displays: `active` resolves to the output holding the
/// focused window, `id` to the named output, `all` to every active one.
///
/// # Errors
/// `CaptureFailed` when the sway tree or outputs cannot be read.
pub fn select_displays(
    ipc: &mut dyn SwayIpc,
    selector: &DisplaySelector,
) -> CoreResult<Vec<DesktopDisplay>> {
    let displays = ipc::outputs(ipc)?;
    match selector {
        DisplaySelector::All => Ok(displays),
        DisplaySelector::Id(id) => displays
            .into_iter()
            .find(|display| display.id.eq_ignore_ascii_case(id))
            .map(|display| vec![display])
            .ok_or_else(|| DesktopError::capture_failed(format!("no sway output named '{id}'"))),
        DisplaySelector::Active => {
            let (windows, active) = ipc::tree(ipc)?.windows();
            let fallback = || {
                displays
                    .iter()
                    .find(|display| display.is_primary)
                    .or_else(|| displays.first())
                    .cloned()
            };
            let by_focus = || {
                windows
                    .iter()
                    .find(|window| window.focused)
                    .and_then(|window| {
                        displays
                            .iter()
                            .find(|display| {
                                f64::from(window.x) >= f64::from(display.x)
                                    && f64::from(window.y) >= f64::from(display.y)
                                    && f64::from(window.x)
                                        < f64::from(display.x) + f64::from(display.width)
                                    && f64::from(window.y)
                                        < f64::from(display.y) + f64::from(display.height)
                            })
                            .cloned()
                    })
            };
            let by_output = || {
                active
                    .as_ref()
                    .and_then(|name| displays.iter().find(|display| &display.id == name).cloned())
            };
            by_focus()
                .or_else(by_output)
                .or_else(fallback)
                .map(|display| vec![display])
                .ok_or_else(|| {
                    DesktopError::capture_failed(
                        "no active sway output and no fallback output exists",
                    )
                })
        }
    }
}

fn sway_window(node: &SwayNode) -> DesktopWindow {
    DesktopWindow {
        id: node.id.to_string(),
        title: node.name.clone().unwrap_or_default(),
        app: node
            .app_id
            .clone()
            .or_else(|| {
                node.window_properties
                    .as_ref()
                    .and_then(|props| props.class.clone())
            })
            .unwrap_or_default(),
        pid: node.pid.and_then(|pid| u32::try_from(pid).ok()),
        x: node.rect.x,
        y: node.rect.y,
        width: u32::try_from(node.rect.width.max(0)).unwrap_or(u32::MAX),
        height: u32::try_from(node.rect.height.max(0)).unwrap_or(u32::MAX),
        focused: node.focused,
        is_on_screen: Some(true),
        elevated: None,
        identity: None,
    }
}
