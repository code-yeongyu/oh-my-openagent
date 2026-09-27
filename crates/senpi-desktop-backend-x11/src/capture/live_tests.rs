//! Live checks against a real X server. `#[ignore]`d: they need `DISPLAY`
//! (CI and QA run them under `xvfb-run`). Run with `--ignored --nocapture`;
//! each prints machine-read `key=value` facts for the QA evidence.

use senpi_desktop_core::types::{DisplaySelector, Target};

use super::{X11Capture, XServer};

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
