//! Object-mode frames over the fake: per-call consume, the window identity
//! re-check at dispatch and at judgment, the point hit, and the route; and
//! the `reportMode: "null"` control that keeps today's replies.

use std::sync::Arc;

use senpi_desktop_backend_fake::{FakeMethod, SinkOp};
use senpi_desktop_core::error::{DesktopError, ErrorCode};
use senpi_desktop_core::protocol_params::{
    AxClickParams, AxQueryParams, AxTypeTextParams, CaptureParams, DragParams, RaiseWindowParams,
};
use senpi_desktop_core::protocol_results::AxInputResult;
use senpi_desktop_core::report::{ActionHit, ActionRoute, Disposition, ReportMode};
use senpi_desktop_core::types::{AxQuery, DesktopWindow};
use senpi_desktop_core::types::{DesktopPoint, DesktopSessionOptions, PointerOptions};
use senpi_desktop_safety::StopPathId;
use serde_json::{json, Value};

use crate::request::{Op, Response};
use crate::grant::ControlSlot;
use crate::test_support::{click_window, delivery, harness, harness_opened, Harness};

/// Window `101` (pid 4242) with a scripted process start, and a labelled
/// element under pixel (10, 10) of its capture.
fn identified(extra: &Value) -> Value {
    let mut overlay = json!({
        "identity": {"101": {"processStart": 1_700_000_000}},
        "hit_at": [{"x": 110, "y": 130, "role": "button", "label": "Delete", "secure": false}],
    });
    for (key, value) in extra.as_object().expect("overlay is an object") {
        overlay[key] = value.clone();
    }
    overlay
}

fn object(overlay: &Value) -> Harness {
    let options = DesktopSessionOptions {
        report_mode: ReportMode::Object,
        ..DesktopSessionOptions::default()
    };
    harness_opened(overlay, ControlSlot::new(), options)
}

fn consuming() -> Option<PointerOptions> {
    Some(PointerOptions {
        consume: true,
        ..PointerOptions::default()
    })
}

fn pointer_posts(harness: &Harness) -> usize {
    harness
        .sink
        .ops()
        .iter()
        .filter(|op| matches!(op, SinkOp::Pointer { .. }))
        .count()
}

fn refusal(result: Result<Response, DesktopError>) -> (ErrorCode, Option<String>, Option<Disposition>) {
    let error = result.expect_err("refused");
    let report = error.report.map(|report| *report).unwrap_or_default();
    (error.code, report.reason, report.disposition)
}

fn drag(frame_id: &str, opts: Option<PointerOptions>) -> Op {
    Op::Drag(DragParams {
        target: "101".to_owned(),
        path: vec![DesktopPoint { x: 10.0, y: 10.0 }, DesktopPoint { x: 40.0, y: 40.0 }],
        frame_id: Some(frame_id.to_owned()),
        opts,
    })
}

#[test]
fn a_consumed_frame_refuses_the_next_click_with_nothing_sent() {
    // Given
    let mut harness = object(&identified(&json!({})));
    let frame = harness.capture("101");
    // When
    let first = harness.process(click_window(&frame, consuming()));
    let second = harness.process(click_window(&frame, None));
    // Then
    assert!(matches!(first, Ok(Response::Action(_))), "{first:?}");
    assert_eq!(
        refusal(second),
        (
            ErrorCode::InvalidCoordinateFrame,
            Some("consumed".to_owned()),
            Some(Disposition::NOT_DELIVERED_SAFE)
        )
    );
    assert_eq!(pointer_posts(&harness), 1);
}

#[test]
fn a_refused_consuming_click_leaves_its_frame_usable() {
    // Given
    let mut harness = object(&identified(&json!({})));
    let frame = harness.capture("101");
    harness.supervisor.set_live(StopPathId::Global, false);
    // When
    let refused = harness.process(click_window(&frame, consuming()));
    harness.supervisor.set_live(StopPathId::Global, true);
    harness.pass_ms(0);
    let retried = harness.process(click_window(&frame, None));
    // Then
    assert_eq!(refused.expect_err("refused").code, ErrorCode::StopPathUnavailable);
    assert!(matches!(retried, Ok(Response::Action(_))), "{retried:?}");
    assert_eq!(pointer_posts(&harness), 1);
}

#[test]
fn a_consuming_drag_consumes_its_frame_once_it_completes() {
    // Given
    let mut harness = object(&identified(&json!({})));
    let frame = harness.capture("101");
    // When
    let dragged = harness.process(drag(&frame, consuming()));
    let after = harness.process(click_window(&frame, None));
    // Then
    assert!(matches!(dragged, Ok(Response::Action(_))), "{dragged:?}");
    assert_eq!(refusal(after).1.as_deref(), Some("consumed"));
    assert_eq!(pointer_posts(&harness), 1);
}

#[test]
fn a_window_whose_owner_changed_since_capture_is_refused_before_any_post() {
    // Given
    let changes = json!({"identity_changes": [{"after_call": "capture", "window": "101",
        "new_pid": 5151, "new_processStart": 1_700_000_999}]});
    let mut harness = object(&identified(&changes));
    let frame = harness.capture("101");
    // When
    let refused = harness.process(click_window(&frame, consuming()));
    let again = harness.process(click_window(&frame, None));
    // Then
    assert_eq!(
        refusal(refused),
        (
            ErrorCode::WindowNotFound,
            Some("identity_changed".to_owned()),
            Some(Disposition::NOT_DELIVERED_SAFE)
        )
    );
    assert_eq!(refusal(again).1.as_deref(), Some("identity_changed"), "the refusal consumed nothing");
    assert_eq!(pointer_posts(&harness), 0);
}

#[test]
fn a_null_mode_session_keeps_todays_gate_when_the_owner_changes() {
    // Given
    let changes = json!({"identity_changes": [{"after_call": "capture", "window": "101",
        "new_pid": 5151, "new_processStart": 1_700_000_999}]});
    let mut harness = harness(&identified(&changes));
    let frame = harness.capture("101");
    // When
    let clicked = harness.process(click_window(&frame, None));
    // Then
    assert!(matches!(clicked, Ok(Response::Unit)), "{clicked:?}");
    assert_eq!(pointer_posts(&harness), 1);
}

#[test]
fn a_drag_judged_after_the_owner_changed_is_delivery_uncertain() {
    // Given
    let changes = json!({"identity_changes": [{"after_call": "drag", "window": "101",
        "new_pid": 5151, "new_processStart": 1_700_000_999}]});
    let mut harness = object(&identified(&changes));
    let frame = harness.capture("101");
    // When
    let judged = harness.process(drag(&frame, consuming()));
    let after = harness.process(click_window(&frame, None));
    // Then
    assert_eq!(
        refusal(judged),
        (
            ErrorCode::WindowNotFound,
            Some("identity_changed".to_owned()),
            Some(Disposition::UNCERTAIN_UNSAFE)
        )
    );
    assert_eq!(refusal(after).1.as_deref(), Some("consumed"), "input was sent, so the frame is spent");
    assert_eq!(pointer_posts(&harness), 1);
}

#[test]
fn a_window_resized_since_capture_is_refused_with_its_reason() {
    // Given
    let mut harness = object(&identified(&json!({"resize_window": {"id": "101", "width": 640, "height": 480}})));
    let frame = harness.capture("101");
    // When
    let refused = harness.process(click_window(&frame, None));
    // Then
    assert_eq!(
        refusal(refused),
        (
            ErrorCode::InvalidCoordinateFrame,
            Some("resized".to_owned()),
            Some(Disposition::NOT_DELIVERED_SAFE)
        )
    );
    assert_eq!(pointer_posts(&harness), 0);
}

#[test]
fn frame_refusals_name_their_reason_in_order() {
    // Given
    let mut harness = object(&identified(&json!({})));
    let no_frame = harness.process(click_window("frame-unknown", None));
    let desktop = harness.capture("desktop");
    let window = harness.capture("101");
    harness.capture("101");
    // When
    let wrong = harness.process(click_window(&desktop, None));
    let stale = harness.process(click_window(&window, None));
    // Then
    assert_eq!(refusal(no_frame).1.as_deref(), Some("no_capture"));
    assert_eq!(refusal(wrong).1.as_deref(), Some("wrong_target"));
    assert_eq!(refusal(stale).1.as_deref(), Some("superseded"));
}

#[test]
fn the_report_names_the_route_and_the_element_hit_before_the_click() {
    // Given
    let secure = json!({"hit_at": [{"x": 110, "y": 130, "role": "textfield", "label": "hunter2", "secure": true}]});
    let mut plain = object(&identified(&json!({})));
    let mut hidden = object(&identified(&secure));
    let (plain_frame, hidden_frame) = (plain.capture("101"), hidden.capture("101"));
    // When
    let plain_report = plain.process(click_window(&plain_frame, None));
    let hidden_report = hidden.process(click_window(&hidden_frame, None));
    // Then
    let Ok(Response::Action(plain_report)) = plain_report else { panic!("{plain_report:?}") };
    let Ok(Response::Action(hidden_report)) = hidden_report else { panic!("{hidden_report:?}") };
    assert_eq!(plain_report.route, Some(ActionRoute::BackgroundWindow));
    assert_eq!(
        plain_report.hit,
        Some(ActionHit { role: "button".to_owned(), label: Some("Delete".to_owned()) })
    );
    assert_eq!(
        hidden_report.hit,
        Some(ActionHit { role: "textfield".to_owned(), label: None }),
        "a secure field's label never leaves the engine"
    );
}

fn close_101(windows: &mut Vec<DesktopWindow>) {
    windows.retain(|window| window.id != "101");
}

fn double() -> Option<PointerOptions> {
    Some(PointerOptions {
        count: Some(2),
        ..PointerOptions::default()
    })
}

#[test]
fn a_single_click_whose_window_then_closes_or_changes_owner_is_delivered() {
    // Given: OK in a dialog closes it; another window is taken over by a new
    // process right after the click.
    let changes = json!({"identity_changes": [{"after_call": "click", "window": "101",
        "new_pid": 5151, "new_processStart": 1_700_000_999}]});
    let mut closed = object(&identified(&json!({})));
    closed.after_pointer.edit_windows(close_101);
    let mut reowned = object(&identified(&changes));
    let (closed_frame, reowned_frame) = (closed.capture("101"), reowned.capture("101"));
    // When
    let closed_reply = closed.process(click_window(&closed_frame, consuming()));
    let reowned_reply = reowned.process(click_window(&reowned_frame, None));
    // Then: one event went out, so nothing is judged after it.
    assert!(matches!(closed_reply, Ok(Response::Action(_))), "{closed_reply:?}");
    assert!(matches!(reowned_reply, Ok(Response::Action(_))), "{reowned_reply:?}");
    assert_eq!((pointer_posts(&closed), pointer_posts(&reowned)), (1, 1));
}

#[test]
fn a_double_click_whose_window_then_closes_is_delivery_uncertain() {
    // Given
    let mut harness = object(&identified(&json!({})));
    harness.after_pointer.edit_windows(close_101);
    let frame = harness.capture("101");
    // When
    let judged = harness.process(click_window(&frame, double()));
    // Then
    assert_eq!(
        refusal(judged),
        (ErrorCode::WindowNotFound, None, Some(Disposition::UNCERTAIN_UNSAFE))
    );
    assert_eq!(pointer_posts(&harness), 1);
}

#[test]
fn a_drag_judged_after_its_window_resized_is_delivery_uncertain() {
    // Given
    let mut harness = object(&identified(&json!({})));
    harness.after_pointer.edit_windows(|windows| {
        windows.iter_mut().filter(|window| window.id == "101").for_each(|window| window.width = 640);
    });
    let frame = harness.capture("101");
    // When
    let judged = harness.process(drag(&frame, None));
    // Then
    assert_eq!(
        refusal(judged),
        (
            ErrorCode::InvalidCoordinateFrame,
            Some("resized".to_owned()),
            Some(Disposition::UNCERTAIN_UNSAFE)
        )
    );
    assert_eq!(pointer_posts(&harness), 1);
}

#[test]
fn a_consuming_drag_stopped_once_its_events_went_out_still_consumes_its_frame() {
    // Given: the stop lands while the drag is being sent.
    let mut harness = object(&identified(&json!({})));
    let supervisor = Arc::clone(&harness.supervisor);
    harness.faults.on_next(FakeMethod::Drag, move || supervisor.suspend_input());
    let frame = harness.capture("101");
    // When
    let stopped = harness.process(drag(&frame, consuming()));
    harness.supervisor.reset_for_test();
    harness.pass_ms(0);
    let after = harness.process(click_window(&frame, None));
    // Then
    assert_eq!(refusal(stopped).0, ErrorCode::Suspended);
    assert_eq!(refusal(after).1.as_deref(), Some("consumed"), "input was sent, so the frame is spent");
    assert_eq!(pointer_posts(&harness), 1);
}

#[test]
fn an_older_frame_of_another_target_is_the_wrong_target() {
    // Given
    let mut harness = object(&identified(&json!({})));
    let older = harness.capture("desktop");
    harness.capture("desktop");
    harness.capture("101");
    // When
    let refused = harness.process(click_window(&older, None));
    // Then
    assert_eq!(refusal(refused).1.as_deref(), Some("wrong_target"));
}

fn element(harness: &mut Harness, role: &str) -> String {
    let query = AxQuery {
        role: Some(role.to_owned()),
        ..AxQuery::default()
    };
    match harness.process(Op::AxQuery(AxQueryParams { target: "101".to_owned(), query })) {
        Ok(Response::Nodes(nodes)) => nodes.into_iter().next().unwrap_or_else(|| panic!("a {role}")).ref_,
        other => panic!("ax.query failed: {other:?}"),
    }
}

fn route_of(reply: Result<Response, DesktopError>) -> Option<ActionRoute> {
    match reply {
        Ok(Response::Action(report)) => report.route,
        Ok(Response::AxInput(AxInputResult { report: Some(report), .. })) => report.route,
        other => panic!("{other:?}"),
    }
}

#[test]
fn the_route_names_the_channel_the_input_events_took() {
    // Given
    let mut harness = object(&identified(&json!({})));
    let button = element(&mut harness, "button");
    let textarea = element(&mut harness, "textarea");
    let ax_click = |reference: &str, opts| Op::AxClick(AxClickParams { ref_: reference.to_owned(), opts });
    let ax_type = |reference: &str| {
        Op::AxTypeText(AxTypeTextParams { ref_: reference.to_owned(), text: "ok".to_owned(), opts: None })
    };
    // When
    let background_click = route_of(harness.process(ax_click(&button, None)));
    let keys = route_of(harness.process(ax_type(&button)));
    let inserted = route_of(harness.process(ax_type(&textarea)));
    harness.grant("click in front");
    let foreground_click = route_of(harness.process(ax_click(&button, delivery("foreground"))));
    let raised = route_of(harness.process(Op::RaiseWindow(RaiseWindowParams { window_id: "101".to_owned() })));
    // Then: ax.click and typed keys are input events; an inserted value and a
    // raise send none.
    assert_eq!(
        [background_click, keys, inserted, foreground_click, raised],
        [
            Some(ActionRoute::BackgroundWindow),
            Some(ActionRoute::BackgroundWindow),
            Some(ActionRoute::Ax),
            Some(ActionRoute::ForegroundHid),
            None
        ]
    );
}

#[test]
fn identity_reaches_capture_and_window_replies_in_object_mode_only() {
    // Given
    let mut object = object(&identified(&json!({})));
    let mut null = harness(&identified(&json!({})));
    let capture = |harness: &mut Harness| match harness.process(Op::Capture(CaptureParams {
        target: "101".to_owned(),
        caps: None,
        exclude_window_titles: None,
    })) {
        Ok(Response::Capture(capture)) => capture.identity,
        other => panic!("{other:?}"),
    };
    let windows = |harness: &mut Harness| match harness.process(Op::Windows) {
        Ok(Response::Windows(windows)) => windows.into_iter().map(|window| window.identity).collect::<Vec<_>>(),
        other => panic!("{other:?}"),
    };
    // When / Then
    let identity = capture(&mut object).expect("object capture names its window's owner");
    assert_eq!((identity.window_number.as_str(), identity.pid, identity.process_start), ("101", 4242, Some(1_700_000_000)));
    assert_eq!(windows(&mut object), vec![Some(identity)]);
    assert_eq!(capture(&mut null), None);
    assert_eq!(windows(&mut null), vec![None]);
}
