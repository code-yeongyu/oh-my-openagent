//! Live checks against the real Windows desktop. `#[ignore]`d: they need an
//! interactive session (the `windows-latest` runner has one). Run with
//! `--ignored --nocapture`; each prints machine-read `key=value` facts for the
//! QA evidence.

use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::types::{DisplaySelector, Target};

use crate::Win32Backend;

#[test]
#[ignore = "live: needs an interactive Windows desktop"]
fn captures_primary_monitor() {
    let primary = Win32Backend::new(DisplaySelector::All)
        .unwrap()
        .displays()
        .unwrap()
        .into_iter()
        .find(|display| display.is_primary)
        .unwrap();
    let backend = Win32Backend::new(DisplaySelector::Id(primary.id.clone())).unwrap();
    let (image, _geometry) = backend.capture(&Target::Desktop).unwrap();
    let path = std::env::temp_dir().join(format!(
        "senpi-desktop-qa-win32-primary-{}.png",
        std::process::id()
    ));
    image.save(&path).unwrap();
    let decoded = image::open(&path).unwrap();
    std::fs::remove_file(&path).unwrap();
    println!(
        "display_id={} scale={} logical={}x{} pixel_width={} pixel_height={} png_width={} png_height={}",
        primary.id,
        primary.scale,
        primary.width,
        primary.height,
        primary.pixel_width,
        primary.pixel_height,
        decoded.width(),
        decoded.height()
    );
    assert_eq!(
        (decoded.width(), decoded.height()),
        (primary.pixel_width, primary.pixel_height)
    );
}

#[test]
#[ignore = "live: needs an interactive Windows desktop"]
fn reports_win32_capabilities_with_integrity_level() {
    let capabilities = Win32Backend::new(DisplaySelector::All).unwrap().capabilities();
    println!("capabilities={capabilities:?}");
    assert_eq!(capabilities.backend, "win32");
    assert!(capabilities.capture && capabilities.display_count >= 1);
    let level = capabilities.integrity_level.unwrap();
    assert!(
        ["low", "medium", "high", "system"].contains(&level.as_str()),
        "{level}"
    );
}

#[test]
#[ignore = "live: needs an interactive Windows desktop"]
fn unknown_display_id_is_rejected_at_open() {
    let error = Win32Backend::new(DisplaySelector::Id("999".into()))
        .err()
        .unwrap();
    println!("code={} message={}", error.code.as_str(), error.message);
    assert_eq!(error.code, ErrorCode::InvalidTarget);
    assert_eq!(error.message, "selected display id '999' is not active");
}

#[test]
#[ignore = "live: needs an interactive Windows desktop"]
fn backend_reopens_after_dpi_awareness_is_fixed() {
    Win32Backend::new(DisplaySelector::All).unwrap();
    let reopened = Win32Backend::new(DisplaySelector::All);
    assert!(reopened.is_ok(), "{:?}", reopened.err());
}
