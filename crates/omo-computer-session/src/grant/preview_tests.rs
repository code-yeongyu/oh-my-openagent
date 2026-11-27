use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use omo_computer_backend_fake::{FakeBackend, RecordingSink, StopPathScript};
use omo_computer_core::backend::FrameBytes;
use omo_computer_core::observation::ImageMime;
use serde_json::json;

use super::session_tests::{capture, params, scenario, session};
use crate::preview::{Dropped, MAX_BYTES};

fn jpeg(width: u32, height: u32, len: usize) -> FrameBytes {
    FrameBytes {
        width,
        height,
        mime: ImageMime::Jpeg,
        bytes: vec![0; len],
        route: None,
        occluders_visible: None,
        cursor: None,
    }
}

fn preview_session(extra: &serde_json::Value, enabled: bool) -> crate::Session {
    let mut s = session(extra, &RecordingSink::default(), None);
    s.open(params(json!({ "reportMode": "object", "settings": { "preview": enabled } }))).expect("open");
    s.stop_path_start(params(json!({})));
    s
}

#[test]
fn preview_only_to_subscriber_only_during_lease_zero_model_bound() {
    let now = Arc::new(AtomicU64::new(0));
    let clock = {
        let now = now.clone();
        Arc::new(move || now.load(Ordering::SeqCst)) as crate::grant::MachineClock
    };
    let mut s = preview_session(&json!({ "session_timeline": [{"t_ms":0}] }), true).with_clock(clock);
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
    let frames = s.take_preview_frames();
    assert_eq!(frames.len(), 1, "a slow subscriber gets only the latest frame");
    assert_eq!((frames[0].at_ms, frames[0].frame.bytes.len()), (500, MAX_BYTES));
    s.control_release();
    now.fetch_add(500, Ordering::SeqCst);
    assert_eq!(s.offer_preview(jpeg(960, 540, 1_000)), Err(Dropped::NoLease), "lease-only");
    assert!(s.take_preview_frames().is_empty());
}

#[test]
fn pending_preview_does_not_survive_a_foreground_lease_end() {
    #[derive(Debug)]
    enum End { Release, Revoke, DisplayRelease, Stop, Hotkey }

    for end in [End::Release, End::Revoke, End::DisplayRelease, End::Stop, End::Hotkey] {
        let backend = FakeBackend::new(scenario(&json!({"session_timeline":[{"t_ms":0}]})))
            .with_stop_path(StopPathScript::Live);
        let keyboard = backend.handle();
        let mut s = crate::Session::new(Box::new(backend));
        s.open(params(json!({"settings":{"preview":true}}))).expect("open");
        s.stop_path_start(params(json!({})));
        s.control_grant(params(json!({"reason":"before"})));
        s.control_acquire().expect("lease");
        s.preview_subscribe();
        s.offer_preview(jpeg(32, 16, 64)).expect("pending frame");

        match end {
            End::Release => s.control_release(),
            End::Revoke => s.control_revoke(),
            End::DisplayRelease => s.display_release(),
            End::Stop => { s.stop_path_stop(params(json!({}))); }
            End::Hotkey => keyboard.press_stop_chord(),
        }
        if matches!(end, End::Release | End::Revoke | End::DisplayRelease) {
            // Reacquire before the first drain: an empty slot must not just be a denied read.
            if matches!(end, End::DisplayRelease) { s.display_resume(); }
            s.control_grant(params(json!({"reason":"after"})));
            s.control_acquire().expect("replacement lease");
        }
        assert!(s.take_preview_frames().is_empty(), "{end:?} delivered a stale picture");
        if matches!(end, End::Stop | End::Hotkey) {
            assert!(!s.holds_lease(), "{end:?} did not invalidate the lease at delivery");
        }
    }
}

#[test]
fn preview_frames_never_reach_model_context() {
    let mut s = preview_session(&json!({ "session_timeline": [{"t_ms":0}] }), true);
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
fn preview_withholds_unknown_protected_or_disabled_pictures() {
    for (extra, enabled) in [
        (json!({}), true),
        (json!({"session_timeline":[{"t_ms":0,"secure_input_active":true}]}), true),
        (json!({"session_timeline":[{"t_ms":0,"screen_locked":true}]}), true),
        (json!({"session_timeline":[{"t_ms":0}]}), false),
    ] {
        let mut s = preview_session(&extra, enabled);
        s.preview_subscribe();
        s.control_grant(params(json!({"reason":"test"})));
        s.control_acquire().expect("lease");
        assert_eq!(s.offer_preview(jpeg(32, 16, 64)), Err(Dropped::PictureWithheld));
        assert!(s.take_preview_frames().is_empty());
    }
}

#[test]
fn preview_subscription_and_frames_do_not_follow_a_reopened_session() {
    let mut s = preview_session(&json!({"session_timeline":[{"t_ms":0}]}), true).with_clock(Arc::new(|| 0));
    s.preview_subscribe();
    s.control_grant(params(json!({"reason":"first"})));
    s.control_acquire().expect("first lease");
    s.offer_preview(jpeg(32, 16, 64)).expect("first session");
    s.close();
    s.open(params(json!({"settings":{"preview":true}}))).expect("new session");
    s.control_grant(params(json!({"reason":"second"})));
    s.control_acquire().expect("second lease");
    assert_eq!(s.offer_preview(jpeg(32, 16, 64)), Err(Dropped::NotSubscribed));
    s.preview_subscribe();
    assert!(s.take_preview_frames().is_empty());
    assert_eq!(s.offer_preview(jpeg(32, 16, 64)), Err(Dropped::TooSoon));
}

#[test]
fn preview_subscriber_cannot_borrow_another_sessions_foreground_lease() {
    let dir = tempfile::tempdir().expect("shared runtime");
    let state = json!({"session_timeline":[{"t_ms":0}]});
    let mut owner = session(&state, &RecordingSink::default(), Some((dir.path(), "owner")));
    let mut other = session(&state, &RecordingSink::default(), Some((dir.path(), "other")));
    for s in [&mut owner, &mut other] {
        s.open(params(json!({"settings":{"preview":true}}))).expect("open");
        s.preview_subscribe();
    }
    owner.control_grant(params(json!({"reason":"owner"})));
    owner.control_acquire().expect("owner lease");
    owner.offer_preview(jpeg(32, 16, 64)).expect("owner can preview");
    assert_eq!(other.offer_preview(jpeg(32, 16, 64)), Err(Dropped::NoLease));
    assert!(other.take_preview_frames().is_empty());
    assert_eq!(owner.take_preview_frames().len(), 1);
}

#[test]
fn later_screen_lock_discards_the_waiting_preview_before_delivery() {
    let mut s = preview_session(&json!({"session_timeline":[
        {"t_ms":100,"screen_locked":true}, {"t_ms":200,"screen_locked":false}
    ]}), true);
    s.preview_subscribe();
    s.control_grant(params(json!({"reason":"test"})));
    s.control_acquire().expect("lease");
    s.offer_preview(jpeg(32, 16, 64)).expect("eligible when offered");
    s.backend.clock().expect("clock").wait_ms(100);
    assert!(s.take_preview_frames().is_empty(), "locked at delivery");
    s.backend.clock().expect("clock").wait_ms(100);
    assert!(s.take_preview_frames().is_empty(), "unlock cannot replay it");
}
