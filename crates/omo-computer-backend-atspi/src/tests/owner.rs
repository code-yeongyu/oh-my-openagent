//! The window join under mixed trust: one frame with trusted extents, its same-title twin's
//! frame at `(0,0)`, and two native windows within the geometry tolerance of the placed one.

use omo_computer_core::error::{EngineCode, Reason};

use super::observe;
use crate::fake::{extents, FakeBus};
use crate::owner::NativeWindow;
use crate::types::Detail;
use crate::AtspiBackend;

#[test]
fn a_placed_frame_two_twins_fit_is_ambiguous() {
    let (mut bus, _) = FakeBus::new();
    let app = bus.app(77, "report-viewer");
    let placed = bus.node(&app, "frame", "Report");
    bus.set_extents(&placed, extents(100, 100, 800, 600));
    let unplaced = bus.node(&app, "frame", "Report");
    bus.set_extents(&unplaced, extents(0, 0, 0, 0));
    let window = |id: &str, x, y| NativeWindow {
        id: id.to_owned(),
        pid: Some(77),
        app: "report-viewer".to_owned(),
        title: "Report".to_owned(),
        bounds: extents(x, y, 800, 600),
    };
    let windows = vec![window("0x1", 100, 100), window("0x2", 150, 140)];
    let mut backend = AtspiBackend::new(Some(bus), Box::new(windows));

    let refused = observe(&mut backend, "0x1").expect_err("both twins fit the placed frame");

    assert_eq!(refused.refusal.code, EngineCode::InvalidTarget);
    assert_eq!(refused.refusal.reason, Some(Reason::Ambiguous));
    let candidates = vec!["0x1".to_owned(), "0x2".to_owned()];
    assert_eq!(refused.detail, Some(Detail::AmbiguousWindow { candidates }));
}
