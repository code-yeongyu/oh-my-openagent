//! The region-covering preflight: display-target input is refused before anything is sent
//! unless a libei region covers every point (d-linux.md 'Preflight admission').

use omo_computer_core::backend::{InputEvent, TaggedInput};
use omo_computer_core::capabilities::CompositorName;
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::params::Point;

use super::support::{send, Rig, US};
use crate::fake::{FakeEis, Mode, Script};

fn moved_to(x: f64, y: f64) -> TaggedInput {
    TaggedInput {
        event: InputEvent::PointerMove(Point { x, y }),
        tag: 3,
    }
}

#[test]
fn point_outside_every_region_is_refused() {
    let rig = Rig::new(US, Mode::Serve);
    let mut backend = rig.socket_backend(CompositorName::Mutter);
    // Below the 1024x768 output on the right: inside the bounding box, outside every region.
    let refusal =
        send(&mut backend, &moved_to(1500.0, 790.0)).expect_err("no region covers the point");
    assert_eq!(refusal.code, EngineCode::InputFailed);
    assert_eq!(refusal.reason, Some(Reason::NoRegion));
    assert!(rig.eis.log().motions.is_empty(), "nothing sent");
    use omo_computer_core::backend::Backend;
    assert_eq!(backend.pointer(), None, "no libei-confirmed point yet");

    assert!(
        send(&mut backend, &moved_to(1500.0, 500.0)).is_ok(),
        "the right output covers this point"
    );
    assert!(
        rig.eis.wait_for(super::support::SETTLE, |log| log.motions
            == vec![(1500.0, 500.0)]),
        "the motion reached the fake"
    );
    assert_eq!(
        backend.pointer(),
        Some(Point {
            x: 1500.0,
            y: 500.0
        }),
        "pointer() is the last libei position"
    );

    // No region announced at all: the frame is pixels_only and coordinates are refused.
    let dir = tempfile::tempdir().expect("temp dir");
    let bare = FakeEis::start(
        dir.path(),
        Script {
            keymap: US.to_owned(),
            regions: Vec::new(),
            mode: Mode::Serve,
            keyboard: true,
        },
    )
    .expect("fake");
    let mut backend = crate::WaylandBackend::new(super::support::options(
        CompositorName::Mutter,
        crate::InputRoute::Socket(bare.socket().to_owned()),
        dir.path().join("c.json"),
    ));
    let refusal = send(&mut backend, &moved_to(10.0, 10.0)).expect_err("pixels only");
    assert_eq!(refusal.code, EngineCode::InvalidCoordinateFrame);
    assert_eq!(refusal.reason, Some(Reason::PixelsOnly));
    assert!(bare.log().motions.is_empty());
}
