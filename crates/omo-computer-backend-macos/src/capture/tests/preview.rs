//! The preview lane (row 21 on macOS, amendment A2): one stream per leased window, pushed only
//! to subscribers while the lease holds, never a model-bound frame.

use omo_computer_core::backend::{CaptureOptions, Target};

use super::kit::{window, FakeHelper, FakeOs, OWN_PID};
use crate::capture::helper::HelperRequest;
use crate::capture::preview::{PreviewLane, PreviewTarget, PREVIEW_LONG_EDGE, PREVIEW_MAX_BYTES};
use crate::capture::Capturer;

fn leased() -> PreviewTarget {
    PreviewTarget {
        window: 7,
        points_long_edge: 1200.0,
    }
}

#[test]
fn preview_stream_stops_with_the_lease_and_never_feeds_a_model_frame() {
    let mut helper = FakeHelper {
        frame: Some((2400, 1200)),
        ..FakeHelper::default()
    };
    let mut lane = PreviewLane::default();
    lane.subscribe(1);
    lane.set_lease(Some(leased()));

    let push = lane
        .tick(0, &mut helper)
        .expect("tick")
        .expect("a frame while leased");
    assert_eq!(push.to, vec![1]);
    assert!(push.jpeg.len() <= PREVIEW_MAX_BYTES && push.jpeg.starts_with(&[0xff, 0xd8]));
    assert_eq!(
        push.width.max(push.height),
        PREVIEW_LONG_EDGE,
        "min(960, 2x points)"
    );
    assert!(matches!(
        helper.requests.first(),
        Some(HelperRequest::StreamStart {
            window: 7,
            fps: 2,
            ..
        })
    ));

    assert!(
        lane.tick(300, &mut helper).expect("tick").is_none(),
        "at most 2 frames per second"
    );
    assert!(lane.tick(500, &mut helper).expect("tick").is_some());

    lane.set_lease(None);
    assert!(lane.tick(1_200, &mut helper).expect("tick").is_none());
    assert!(matches!(
        helper.requests.last(),
        Some(HelperRequest::StreamStop { window: 7, .. })
    ));
    let after = helper.requests.len();
    assert!(lane.tick(2_000, &mut helper).expect("tick").is_none());
    assert_eq!(helper.requests.len(), after, "no stream without a lease");

    let mut capturer = Capturer::new(FakeOs::with_windows(vec![window(7, 70)]), OWN_PID);
    let options = CaptureOptions {
        cursor: false,
        crosshair: None,
        region: None,
    };
    capturer
        .capture(&Target::Window("7".into()), &options)
        .expect("model frame");
    assert_eq!(
        capturer.os().helper.stream_requests(),
        0,
        "a model frame is always a still"
    );
}

#[test]
fn no_subscriber_means_no_stream() {
    let mut helper = FakeHelper::default();
    let mut lane = PreviewLane::default();
    lane.set_lease(Some(leased()));
    assert!(lane.tick(0, &mut helper).expect("tick").is_none());
    assert!(helper.requests.is_empty());
    lane.subscribe(3);
    assert!(lane.tick(10, &mut helper).expect("tick").is_some());
    lane.unsubscribe(3);
    assert!(lane.tick(1_000, &mut helper).expect("tick").is_none());
    assert!(matches!(
        helper.requests.last(),
        Some(HelperRequest::StreamStop { .. })
    ));
}

#[test]
fn small_window_previews_at_twice_its_points() {
    let mut helper = FakeHelper {
        frame: Some((1600, 800)),
        ..FakeHelper::default()
    };
    let mut lane = PreviewLane::default();
    lane.subscribe(1);
    lane.set_lease(Some(PreviewTarget {
        window: 7,
        points_long_edge: 300.0,
    }));
    let push = lane.tick(0, &mut helper).expect("tick").expect("frame");
    assert_eq!((push.width, push.height), (600, 300));
}
