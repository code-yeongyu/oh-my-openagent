//! Live legs on the Windows runner (`--include-ignored`): the real seam on an interactive desktop.

use omo_computer_core::backend::{Backend, CaptureOptions, Target};
use omo_computer_core::capabilities::CaptureRoute;

use super::{is_blank, CaptureOs};
use crate::Win32Backend;

const OPTIONS: CaptureOptions = CaptureOptions {
    cursor: true,
    crosshair: None,
    region: None,
};

#[test]
#[ignore = "live: needs an interactive Windows desktop"]
fn live_session_is_interactive_and_wgc_is_supported() {
    let mut os = super::os::Os::default();
    assert_ne!(
        os.session_id(),
        0,
        "the interactive job runs outside Session 0"
    );
    assert!(
        os.wgc_supported(),
        "SP-N n-wgc-issupported-interactive: IsSupported is true"
    );
}

#[test]
#[ignore = "live: needs an interactive Windows desktop"]
fn live_primary_display_capture_is_a_physical_wgc_frame() {
    let mut backend = Win32Backend::new();
    let displays = backend.displays().expect("displays");
    let primary = displays
        .iter()
        .find(|display| display.primary)
        .expect("a primary display");
    let record = backend
        .capture_record(&Target::Display(primary.id.clone()), &OPTIONS)
        .expect("display frame");
    assert_eq!(record.route, CaptureRoute::Wgc);
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let physical = (primary.bounds.width as u32, primary.bounds.height as u32);
    assert_eq!((record.width, record.height), physical);
    assert!(!is_blank(&record.bgra));
    assert!(backend.capabilities().capture.available);
}
