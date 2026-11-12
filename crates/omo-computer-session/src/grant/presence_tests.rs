use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use omo_computer_backend_fake::RecordingSink;
use omo_computer_core::backend::FrameBytes;
use omo_computer_core::observation::ImageMime;
use serde_json::json;

use super::session_tests::{capture, params, reason, session};
use crate::preview::{Dropped, MAX_BYTES};

fn jpeg(width: u32, height: u32, len: usize) -> FrameBytes {
    FrameBytes {
        width,
        height,
        mime: ImageMime::Jpeg,
        bytes: vec![0; len],
    }
}

#[test]
fn lease_without_presence_surface_refused() {
    let sink = RecordingSink::default();
    let mut s = session(&json!({ "presence_surface": false }), &sink, None);
    s.control_grant(params(json!({ "reason": "r" })));
    let click = s.click(params(json!({ "target": "desktop", "x": 5, "y": 5 })));
    assert_eq!(reason(&click), Some(("ControlRequired", Some("no_presence_surface"))));
    let code = click.expect_err("refused").refusal.computer_code().expect("row");
    assert_eq!(code.wire(), "COMPUTER_PRESENCE_UNAVAILABLE");
    assert_eq!(reason(&s.control_acquire()), Some(("ControlRequired", Some("no_presence_surface"))));
    assert!(!s.holds_lease());
    assert!(sink.is_empty(), "{:?}", sink.lines());
}

#[test]
fn display_release_ends_lease_user_moved_on_no_suspended() {
    let sink = RecordingSink::default();
    let mut s = session(&json!({ "object": true }), &sink, None);
    s.control_grant(params(json!({ "reason": "r" })));
    capture(&mut s, "desktop");
    capture(&mut s, "1");
    s.click(params(json!({ "target": "desktop", "x": 5, "y": 5 }))).expect("foreground click");
    assert!(s.holds_lease());
    s.display_release();
    assert!(!s.holds_lease() && s.display_released());
    assert!(sink.lines().iter().any(|line| line.contains("presence hide")), "{:?}", sink.lines());
    let next = s.click(params(json!({ "target": "1", "x": 1, "y": 1 }))).expect("the run continues");
    let report = serde_json::to_value(&next).expect("report");
    assert_eq!(report["focusRestoration"], json!("user_moved_on"));
    assert!(!s.stop_path_status().suspended, "no Suspended");
    let after = s.click(params(json!({ "target": "1", "x": 1, "y": 1 }))).expect("again");
    assert!(serde_json::to_value(&after).expect("report").get("focusRestoration").is_none());
    s.display_resume();
    assert!(!s.display_released() && !s.holds_lease(), "resume restores no lease");
}

#[test]
fn preview_only_to_subscriber_only_during_lease_zero_model_bound() {
    let now = Arc::new(AtomicU64::new(0));
    let clock = {
        let now = now.clone();
        Arc::new(move || now.load(Ordering::SeqCst)) as crate::grant::MachineClock
    };
    let mut s = session(&json!({}), &RecordingSink::default(), None).with_clock(clock);
    assert_eq!(s.offer_preview(jpeg(960, 540, 1_000)), Err(Dropped::NotSubscribed));
    s.preview_subscribe();
    assert_eq!(s.offer_preview(jpeg(960, 540, 1_000)), Err(Dropped::NoLease));
    s.control_grant(params(json!({ "reason": "r" })));
    s.control_acquire().expect("lease");
    assert_eq!(s.offer_preview(jpeg(960, 540, 1_000)), Ok(()));
    now.fetch_add(499, Ordering::SeqCst);
    assert_eq!(s.offer_preview(jpeg(960, 540, 1_000)), Err(Dropped::TooSoon), "<= 2 per second");
    now.fetch_add(1, Ordering::SeqCst);
    assert_eq!(s.offer_preview(jpeg(961, 540, 1_000)), Err(Dropped::TooLarge));
    assert_eq!(s.offer_preview(jpeg(540, 961, 1_000)), Err(Dropped::TooLarge));
    assert_eq!(s.offer_preview(jpeg(960, 540, MAX_BYTES + 1)), Err(Dropped::TooLarge));
    let png = FrameBytes { mime: ImageMime::Png, ..jpeg(10, 10, 10) };
    assert_eq!(s.offer_preview(png), Err(Dropped::NotJpeg));
    assert_eq!(s.offer_preview(jpeg(960, 540, MAX_BYTES)), Ok(()));
    s.control_release();
    now.fetch_add(500, Ordering::SeqCst);
    assert_eq!(s.offer_preview(jpeg(960, 540, 1_000)), Err(Dropped::NoLease), "lease-only");
    assert_eq!(s.take_preview_frames().len(), 2);
}

#[test]
fn preview_frames_never_reach_model_context() {
    let mut s = session(&json!({ "object": true }), &RecordingSink::default(), None);
    assert_eq!(s.offer_preview(jpeg(320, 200, 64)), Err(Dropped::NotSubscribed));
    s.preview_subscribe();
    s.control_grant(params(json!({ "reason": "r" })));
    s.control_acquire().expect("lease");
    s.offer_preview(jpeg(320, 200, 64)).expect("emitted to the host");
    capture(&mut s, "desktop");
    let reply = s.click(params(json!({ "target": "desktop", "x": 5, "y": 5 }))).expect("click");
    let text = serde_json::to_string(&reply).expect("reply");
    assert!(!text.contains("preview") && !text.contains("image/jpeg"), "{text}");
    let frames = s.take_preview_frames();
    assert_eq!(frames.len(), 1, "the frame went to the host outbox only");
    assert!(s.take_preview_frames().is_empty());
}

#[test]
fn host_call_serves_only_its_own_table_methods_with_typed_params() {
    use omo_computer_core::methods::Method;
    let mut s = session(&json!({}), &RecordingSink::default(), None);
    assert!(s.host_call(Method::Click, json!({})).is_none(), "not a host call");
    assert!(s.host_call(Method::MenuItems, json!({})).is_none(), "a later row's method answers None here");
    let granted = s.host_call(Method::ControlGrant, json!({ "reason": "r" })).expect("served").expect("granted");
    assert_eq!(granted["active"], json!(true));
    assert!(matches!(
        s.host_call(Method::ControlGrant, json!({ "reason": 7 })),
        Some(Err(crate::grant::HostCallError::Params(_)))
    ));
    assert_eq!(s.host_call(Method::ControlAcquire, json!({})).expect("served").expect("lease")["active"], json!(true));
    assert!(matches!(s.host_call(Method::ControlAcquire, json!({})), Some(Err(crate::grant::HostCallError::Refused(_)))));
}

#[test]
fn every_lease_end_goes_through_one_funnel() {
    let sink = RecordingSink::default();
    let mut s = session(&json!({ "object": true }), &sink, None);
    s.control_grant(params(json!({ "reason": "r" })));
    capture(&mut s, "1");
    s.control_acquire().expect("lease");
    s.control_release();
    assert!(!s.holds_lease(), "the slot is free");
    assert!(sink.lines().iter().any(|line| line.contains("presence hide")), "{:?}", sink.lines());
    let next = s.click(params(json!({ "target": "1", "x": 1, "y": 1 }))).expect("the run continues");
    let report = serde_json::to_value(&next).expect("report");
    assert!(report.get("focusRestoration").is_none(), "a session's own release is not user_moved_on: {report}");
    s.control_grant(params(json!({ "reason": "r" })));
    s.control_acquire().expect("lease again");
    s.display_release();
    let after = s.click(params(json!({ "target": "1", "x": 1, "y": 1 }))).expect("still running");
    assert_eq!(serde_json::to_value(&after).expect("report")["focusRestoration"], json!("user_moved_on"),
        "a user-side end still reports");
}

#[derive(Clone, Default)]
struct Recorded(std::sync::Arc<std::sync::Mutex<Vec<String>>>);

impl super::LeaseHook for Recorded {
    fn lease_ended(&mut self, _backend: &mut dyn omo_computer_core::backend::Backend, why: crate::presence::LeaseEnd) {
        self.0.lock().expect("lock").push(format!("ended {why:?}"));
    }

    fn display_resumed(&mut self, _backend: &mut dyn omo_computer_core::backend::Backend) {
        self.0.lock().expect("lock").push("resumed".to_owned());
    }
}

#[test]
fn every_lease_end_path_calls_the_hook_once_with_its_cause() {
    let sink = RecordingSink::default();
    let mut s = session(&json!({ "object": true }), &sink, None);
    let calls = Recorded::default();
    s.set_lease_hook(Box::new(calls.clone()));
    let taken = || std::mem::take(&mut *calls.0.lock().expect("lock"));

    s.control_grant(params(json!({ "reason": "r" })));
    capture(&mut s, "1");
    s.control_acquire().expect("lease");
    s.control_release();
    assert_eq!(taken(), ["ended Release"], "control.release, through the funnel");

    s.control_acquire().expect("lease again");
    s.display_release();
    assert_eq!(taken(), ["ended DisplayRelease"], "display.release, through the funnel");

    s.display_resume();
    assert_eq!(taken(), ["resumed"], "display.resume");

    s.control_acquire().expect("lease a third time");
    s.end_lease(crate::presence::LeaseEnd::DisplayRelease);
    assert_eq!(taken(), ["ended DisplayRelease"], "a direct end_lease");
}
