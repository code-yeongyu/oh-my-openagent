//! Live Screenshot-portal round trip (gorky: `sway --headless` with
//! `xdg-desktop-portal` + `xdg-desktop-portal-wlr` on a private session
//! bus). `#[ignore]`d; run with `--ignored portal_screenshot_returns_png
//! --nocapture`. The QA script checks the PNG size against an independent
//! `grim` shot of the same output.

use senpi_desktop_core::backend::Backend;
use senpi_desktop_core::types::{CaptureCaps, DisplaySelector, Target};

use crate::WaylandBackend;

#[test]
#[ignore = "live: needs a Wayland session with a Screenshot portal"]
fn portal_screenshot_returns_png() {
    assert!(
        std::env::var_os("WAYLAND_DISPLAY").is_some(),
        "precondition: a Wayland session"
    );
    let mut backend = WaylandBackend::new(DisplaySelector::All);
    let before = backend.capabilities();

    let (image, _) = backend
        .capture(&Target::Desktop, &CaptureCaps::default())
        .expect("portal screenshot");

    let after = backend.capabilities();
    println!(
        "before_capture={} before_capture_permission={} image={}x{} after_capture={} \
         after_capture_permission={} display_count={}",
        before.capture,
        before.capture_permission,
        image.width(),
        image.height(),
        after.capture,
        after.capture_permission,
        after.display_count
    );
    assert!(!before.capture);
    assert_eq!(before.capture_permission, "prompt-or-granted");
    assert!(image.width() > 0 && image.height() > 0);
    assert!(after.capture);
    assert_eq!(after.capture_permission, "granted");
}
