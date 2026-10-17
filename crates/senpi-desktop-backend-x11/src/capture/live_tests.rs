//! Live checks against a real X server. `#[ignore]`d: they need `DISPLAY`
//! (CI and QA run them under `xvfb-run`). Run with `--ignored --nocapture`;
//! each prints machine-read `key=value` facts for the QA evidence.

use senpi_desktop_core::types::{DisplaySelector, Target};

use super::{X11Capture, XServer};

fn window_env(name: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| panic!("precondition: {name} is set"))
}

#[test]
#[ignore = "live: needs an X server on DISPLAY (xvfb-run)"]
fn captures_root_window() {
    let capture = X11Capture::new(DisplaySelector::All).unwrap();
    let screen = capture.server.screen();
    let displays = capture.displays().unwrap();
    let windows = capture.windows().unwrap();

    let (image, _frame) = capture.capture(&Target::Desktop).unwrap();

    let path = std::env::temp_dir().join("senpi-desktop-x11-root.png");
    image.save(&path).unwrap();
    println!(
        "png_path={} image_width={} image_height={} root_width={} root_height={} displays={} windows={}",
        path.display(),
        image.width(),
        image.height(),
        screen.width,
        screen.height,
        displays.len(),
        windows.len()
    );
    assert_eq!((image.width(), image.height()), (screen.width, screen.height));
}

#[test]
#[ignore = "live: needs a partially offscreen SENPI_X11_TARGET window"]
fn captures_a_partially_offscreen_window_in_a_targetable_full_frame() {
    let capture = X11Capture::new(DisplaySelector::All).unwrap();
    let id = window_env("SENPI_X11_TARGET");
    let target = Target::Window(id.clone());
    let window = capture
        .windows()
        .unwrap()
        .into_iter()
        .find(|window| window.id == id)
        .expect("target window is enumerated");

    let (image, frame) = capture.capture(&target).unwrap();

    let path = std::env::var("SENPI_X11_CAPTURE_PATH")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir().join("senpi-desktop-x11-offscreen.png"));
    image.save(&path).unwrap();
    let visible_x = f64::from(window.x.saturating_neg());
    let visible_y = f64::from(window.y.saturating_neg());
    println!(
        "png_path={} target={} window=({},{} {}x{}) image={}x{} visible_origin=({visible_x},{visible_y})",
        path.display(),
        window.id,
        window.x,
        window.y,
        window.width,
        window.height,
        image.width(),
        image.height()
    );
    assert_eq!((image.width(), image.height()), (window.width, window.height));
    assert_eq!(
        frame.map_point(visible_x, visible_y, Some(&window)).unwrap(),
        (0.0, 0.0)
    );
}
