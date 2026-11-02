//! Startup classification through real helper pipes and the fallback router.

use std::time::Duration;

use senpi_desktop_core::types::{DisplaySelector, Target};

use super::super::sck::test_support::{fake_helper, ProgramGuard};
use super::super::Screencapture;
use super::test_support::ReasonsGuard;
use super::{MacCapture, SckWorker};

#[test]
fn an_immediately_exiting_helper_routes_to_fallback_without_error() {
    let _reasons = ReasonsGuard::new();
    let dir = tempfile::tempdir().unwrap();
    let helper = fake_helper(&dir, "#!/usr/bin/env python3\nimport os\nos._exit(1)\n");
    let _program = ProgramGuard::new(helper);
    let capture = MacCapture::new(
        DisplaySelector::All,
        Screencapture::with("/usr/bin/true".into(), Duration::from_secs(60), || true),
    );
    let result = capture.capture_via_sck(&Target::Window("42".to_owned()), &[], &[]);
    assert!(matches!(result, Ok(None)), "{result:?}");
}

#[test]
#[ignore = "live: needs WindowServer, Screen Recording and macOS 14+"]
fn an_immediately_exiting_helper_returns_a_legacy_capture() {
    let _reasons = ReasonsGuard::new();
    assert!(SckWorker::availability().is_ok(), "requires the SCK route");
    let dir = tempfile::tempdir().unwrap();
    let helper = fake_helper(&dir, "#!/usr/bin/env python3\nimport os\nos._exit(1)\n");
    let _program = ProgramGuard::new(helper);
    let capture = MacCapture::new(DisplaySelector::All, Screencapture::system());
    let (image, geometry) = capture.capture(&Target::Desktop).unwrap();
    assert!(geometry.is_legacy_capture());
    assert!(image.width() > 0 && image.height() > 0);
}
