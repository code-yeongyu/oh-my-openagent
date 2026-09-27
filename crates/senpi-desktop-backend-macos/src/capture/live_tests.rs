//! Live checks against the real WindowServer. `#[ignore]`d: they need a
//! logged-in macOS session and, except the denial check, a Screen Recording
//! grant for the launching process. Run with `--ignored --nocapture`; each
//! prints machine-read `key=value` facts for the QA evidence.

use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::time::Duration;

use image::RgbaImage;
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::types::{DesktopDisplay, DisplaySelector, Target};

use super::{capture_permission, MacCapture, Screencapture};
use crate::MacosBackend;

fn primary_display() -> DesktopDisplay {
    MacCapture::new(DisplaySelector::All, Screencapture::system())
        .displays()
        .unwrap()
        .into_iter()
        .find(|display| display.is_primary)
        .unwrap()
}

fn save(image: &RgbaImage, name: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!("senpi-desktop-qa-{name}.png"));
    image.save(&path).unwrap();
    path
}

#[test]
#[ignore = "live: needs a Screen Recording grant for the launcher"]
fn captures_primary_display_png() {
    let primary = primary_display();
    let capture = MacCapture::new(DisplaySelector::Id(primary.id.clone()), Screencapture::system());
    let (image, _geometry) = capture.capture(&Target::Desktop).unwrap();
    let path = save(&image, "primary");
    println!(
        "png_path={} display_id={} pixel_width={} pixel_height={} image_width={} image_height={}",
        path.display(),
        primary.id,
        primary.pixel_width,
        primary.pixel_height,
        image.width(),
        image.height()
    );
    assert_eq!(
        (image.width(), image.height()),
        (primary.pixel_width, primary.pixel_height)
    );
}

#[test]
#[ignore = "live: needs a Screen Recording grant for the launcher"]
fn captures_window_by_id() {
    let capture = MacCapture::new(DisplaySelector::All, Screencapture::system());
    let window = capture.windows().unwrap().into_iter().next().unwrap();
    let (image, _geometry) = capture.capture(&Target::Window(window.id.clone())).unwrap();
    let path = save(&image, "window");
    println!(
        "png_path={} window_id={} app={:?} logical={}x{} image_width={} image_height={}",
        path.display(),
        window.id,
        window.app,
        window.width,
        window.height,
        image.width(),
        image.height()
    );
    assert!(image.width() > 0 && image.height() > 0);
}

#[test]
#[ignore = "live: needs a Screen Recording grant for the launcher"]
fn falls_back_to_core_graphics_when_screencapture_fails() {
    let dir = tempfile::tempdir().unwrap();
    let script = dir.path().join("screencapture");
    std::fs::write(&script, "#!/bin/sh\nexit 1\n").unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    let primary = primary_display();
    // 60 s hang guard: the fake exits at once, but a fresh unsigned script's
    // first exec can exceed the production 5 s deadline on a loaded host.
    let shooter = Screencapture::with(script, Duration::from_secs(60), capture_permission);
    let capture = MacCapture::new(DisplaySelector::Id(primary.id.clone()), shooter);
    let (image, _geometry) = capture.capture(&Target::Desktop).unwrap();
    let path = save(&image, "fallback");
    let decoded = image::open(&path).unwrap();
    println!(
        "png_path={} decoded_width={} decoded_height={}",
        path.display(),
        decoded.width(),
        decoded.height()
    );
    assert!(decoded.width() > 0 && decoded.height() > 0);
}

#[test]
#[ignore = "live: run from a launcher WITHOUT a Screen Recording grant"]
fn reports_tcc_identity_when_screen_recording_is_denied() {
    assert!(
        !capture_permission(),
        "precondition: this launcher must lack Screen Recording"
    );
    let capture = MacCapture::new(DisplaySelector::All, Screencapture::system());
    let error = capture.capture(&Target::Desktop).unwrap_err();
    println!("code={} message={}", error.code.as_str(), error.message);
    assert_eq!(error.code, ErrorCode::PermissionDenied);
    assert!(error.message.contains("TCC identity: executable="));
}

#[test]
#[ignore = "live: needs a Screen Recording grant for the launcher"]
fn reports_quartz_capabilities_with_active_displays() {
    let capabilities = MacosBackend::new(DisplaySelector::All)
        .expect("backend")
        .capabilities();
    println!("capabilities={capabilities:?}");
    assert!(capabilities.capture && capabilities.display_count >= 1);
}
