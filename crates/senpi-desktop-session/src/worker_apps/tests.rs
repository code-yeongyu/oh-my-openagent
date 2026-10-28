//! `apps.open` is admitted without the grant in the background, needs it with
//! `activate`/`reveal` (D5), is audited either way, and restores nothing.

use senpi_desktop_backend_fake::{FakeMethod, SinkOp};
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::methods::Method;
use senpi_desktop_core::protocol_params::{AppsListParams, AppsOpenParams};
use serde_json::json;

use crate::request::{Op, Response};
use crate::test_support::harness;

fn open(id: &str) -> AppsOpenParams {
    AppsOpenParams { id: id.to_owned(), activate: None, reveal: None, app: None }
}

#[test]
fn opening_in_the_background_needs_no_grant_and_is_audited_as_background() {
    // Given: nobody granted foreground control; Notes owns the fixture window
    let mut harness = harness(&json!({}));
    assert!(harness.worker.control.is_none());
    // When
    let reply = harness.process(Op::AppsOpen(open("Notes")));
    // Then: opened, its window returned, nothing focused or restored, one audit
    let Ok(Response::OpenedApplication(opened)) = reply else { panic!("{reply:?}") };
    assert_eq!((opened.id.as_str(), opened.running, opened.window.map(|w| w.id)), ("Notes", true, Some("101".into())));
    assert_eq!(
        harness.sink.ops(),
        [SinkOp::OpenApp { id: "Notes".into(), activate: false, reveal: false }]
    );
    let audits = harness.audits();
    assert_eq!(audits.len(), 1, "{audits:?}");
    let audit = &audits[0];
    assert_eq!(
        (audit.action, audit.target.as_str(), audit.delivery.as_str(), audit.code, audit.focus_restored),
        (Method::AppsOpen, "Notes", "background", None, None)
    );
}

#[test]
fn activating_without_the_grant_is_control_required_and_launches_nothing() {
    for params in [
        AppsOpenParams { activate: Some(true), ..open("Notes") },
        AppsOpenParams { reveal: Some(true), ..open("/tmp") },
    ] {
        // Given: no grant
        let mut harness = harness(&json!({}));
        // When
        let reply = harness.process(Op::AppsOpen(params.clone()));
        // Then: refused before the backend ran, audited as foreground
        let error = reply.expect_err("refused");
        assert_eq!(error.code, ErrorCode::ControlRequired, "{params:?}");
        assert!(error.message.contains("nothing was launched"), "{}", error.message);
        assert_eq!(harness.sink.ops(), Vec::new(), "{params:?}");
        let audited: Vec<_> = harness.audits().into_iter().map(|a| (a.delivery, a.code)).collect();
        assert_eq!(audited, [("foreground".to_owned(), Some(ErrorCode::ControlRequired))]);
    }
}

#[test]
fn activating_under_the_grant_opens_in_front_and_is_audited_as_foreground() {
    // Given: a live grant
    let mut harness = harness(&json!({}));
    harness.grant("open Notes in front");
    harness.audits.lock().clear();
    // When
    let reply = harness.process(Op::AppsOpen(AppsOpenParams { activate: Some(true), ..open("Notes") }));
    // Then
    assert!(reply.is_ok(), "{reply:?}");
    assert_eq!(harness.sink.ops(), [SinkOp::OpenApp { id: "Notes".into(), activate: true, reveal: false }]);
    let audit = harness.audits().pop().expect("one audit");
    assert_eq!((audit.action, audit.delivery.as_str(), audit.code, audit.focus_restored), (Method::AppsOpen, "foreground", None, None));
}

#[test]
fn an_unknown_application_is_invalid_target_and_audited() {
    let mut harness = harness(&json!({}));
    let reply = harness.process(Op::AppsOpen(open("Nope")));
    assert_eq!(reply.map_err(|error| error.code), Err(ErrorCode::InvalidTarget));
    let codes: Vec<_> = harness.audits().into_iter().map(|audit| audit.code).collect();
    assert_eq!(codes, [Some(ErrorCode::InvalidTarget)]);
    assert_eq!(harness.sink.ops(), [SinkOp::ReleaseAll]);
}

#[test]
fn a_refused_open_is_audited_with_the_backends_code() {
    let mut harness = harness(&json!({}));
    harness.faults.fail_next(FakeMethod::AppsOpen, ErrorCode::Timeout);
    let reply = harness.process(Op::AppsOpen(open("Notes")));
    assert_eq!(reply.map_err(|error| error.code), Err(ErrorCode::Timeout));
    let codes: Vec<_> = harness.audits().into_iter().map(|audit| audit.code).collect();
    assert_eq!(codes, [Some(ErrorCode::Timeout)]);
}

#[test]
fn listing_applications_is_a_read_that_is_never_audited() {
    let mut harness = harness(&json!({
        "apps": [{"id": "com.apple.TextEdit", "name": "TextEdit", "path": "/System/Applications/TextEdit.app"}]
    }));
    let reply = harness.process(Op::AppsList(AppsListParams::default()));
    let Ok(Response::Applications(apps)) = reply else { panic!("{reply:?}") };
    let listed: Vec<_> = apps.iter().map(|app| (app.name.as_str(), app.running)).collect();
    assert_eq!(listed, [("Notes", true), ("TextEdit", false)]);
    assert!(harness.audits().is_empty());
    let running = harness.process(Op::AppsList(AppsListParams { query: None, running_only: Some(true) }));
    let Ok(Response::Applications(running)) = running else { panic!("{running:?}") };
    assert_eq!(running.iter().map(|app| app.id.as_str()).collect::<Vec<_>>(), ["Notes"]);
}
