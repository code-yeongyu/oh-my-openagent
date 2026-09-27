use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::time::Duration;

use image::{Rgba, RgbaImage};
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::types::{DesktopDisplay, DisplaySelector, Target};

use super::displays::composite;
use super::screencapture::{display_rect_arg, window_args, Screencapture, ShotError};
use super::MacCapture;

/// Hang guard for fakes that exit immediately; only the deadline test relies
/// on expiry, so a loaded host cannot flip these results.
const DEADLINE: Duration = Duration::from_secs(60);

fn display(id: &str, x: i32, width: u32, height: u32) -> DesktopDisplay {
    DesktopDisplay {
        id: id.to_string(),
        name: id.to_string(),
        x,
        y: 0,
        width,
        height,
        scale: 1.0,
        pixel_x: 0,
        pixel_y: 0,
        pixel_width: width,
        pixel_height: height,
        is_primary: x == 0,
    }
}

/// A fake `screencapture`: an executable shell script whose last argument is
/// the output PNG path.
fn fake_program(dir: &Path, body: &str) -> PathBuf {
    let path = dir.join("screencapture");
    std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path
}

fn run(program: PathBuf, deadline: Duration, permission: fn() -> bool) -> Result<RgbaImage, ShotError> {
    Screencapture::with(program, deadline, permission).run(&["-x".to_string()])
}

#[test]
fn display_rect_arg_keeps_negative_global_origin() {
    let left = DesktopDisplay {
        y: -120,
        ..display("2", -1440, 1440, 900)
    };
    assert_eq!(display_rect_arg(&left), "-R-1440,-120,1440,900");
}

#[test]
fn window_args_capture_silently_without_shadow() {
    assert_eq!(window_args(4242), ["-x", "-o", "-l", "4242"]);
}

#[test]
fn nonzero_exit_without_permission_is_permission_denied_with_tcc_identity() {
    let dir = tempfile::tempdir().unwrap();
    let result = run(fake_program(dir.path(), "exit 1"), DEADLINE, || false);
    let Err(ShotError::Fatal(error)) = result else {
        panic!("expected a fatal error, got {result:?}");
    };
    assert_eq!(error.code, ErrorCode::PermissionDenied);
    assert!(
        error.message.contains("TCC identity: executable="),
        "{}",
        error.message
    );
}

#[test]
fn nonzero_exit_with_permission_allows_the_fallback() {
    let dir = tempfile::tempdir().unwrap();
    let result = run(fake_program(dir.path(), "exit 1"), DEADLINE, || true);
    assert!(matches!(result, Err(ShotError::Unavailable(_))), "{result:?}");
}

#[test]
fn absent_program_allows_the_fallback() {
    let dir = tempfile::tempdir().unwrap();
    let result = run(dir.path().join("missing-screencapture"), DEADLINE, || true);
    assert!(matches!(result, Err(ShotError::Unavailable(_))), "{result:?}");
}

#[test]
fn successful_run_decodes_the_written_png_as_rgba() {
    let dir = tempfile::tempdir().unwrap();
    let fixture = dir.path().join("fixture.png");
    RgbaImage::from_pixel(7, 3, Rgba([1, 2, 3, 255]))
        .save(&fixture)
        .unwrap();
    let body = format!("for last; do :; done\ncp '{}' \"$last\"", fixture.display());
    let image = run(fake_program(dir.path(), &body), DEADLINE, || true).unwrap();
    assert_eq!((image.width(), image.height()), (7, 3));
    assert_eq!(image.get_pixel(6, 2), &Rgba([1, 2, 3, 255]));
}

#[test]
fn run_past_the_deadline_is_capture_failed_without_fallback() {
    let dir = tempfile::tempdir().unwrap();
    let result = run(
        fake_program(dir.path(), "exec sleep 30"),
        Duration::from_millis(50),
        || true,
    );
    let Err(ShotError::Fatal(error)) = result else {
        panic!("expected a fatal error, got {result:?}");
    };
    assert_eq!(error.code, ErrorCode::CaptureFailed);
}

#[test]
fn non_numeric_window_id_is_an_invalid_target() {
    let dir = tempfile::tempdir().unwrap();
    let shooter = Screencapture::with(fake_program(dir.path(), "exit 1"), DEADLINE, || true);
    let error = MacCapture::new(DisplaySelector::All, shooter)
        .capture(&Target::Window("atspi::1.31".to_string()))
        .unwrap_err();
    assert_eq!(error.code, ErrorCode::InvalidTarget);
}

#[test]
fn composite_renders_mixed_scales_at_the_highest_scale() {
    let retina = (
        display("1", 0, 100, 50),
        RgbaImage::from_pixel(200, 100, Rgba([255, 0, 0, 255])),
    );
    let plain = (
        display("2", 100, 100, 50),
        RgbaImage::from_pixel(100, 50, Rgba([0, 0, 255, 255])),
    );
    let (image, _geometry) = composite(vec![retina, plain]).unwrap();
    assert_eq!((image.width(), image.height()), (400, 100));
    assert_eq!(image.get_pixel(199, 99), &Rgba([255, 0, 0, 255]));
    assert_eq!(image.get_pixel(200, 0), &Rgba([0, 0, 255, 255]));
    assert_eq!(image.get_pixel(399, 99), &Rgba([0, 0, 255, 255]));
}
