//! The actionability battery, opened surfaces, refusal hints and dangerous
//! chords over scripted fake windows.

use std::time::{Duration, Instant};

use senpi_desktop_backend_fake::SinkOp;
use senpi_desktop_core::error::{DesktopError, ErrorCode, ErrorReport};
use senpi_desktop_core::methods::Method;
use senpi_desktop_core::protocol_params::{AxPerformParams, KeyChordParams, TypeTextParams};
use senpi_desktop_core::report::{ActionReport, Disposition, ReportMode};
use senpi_desktop_core::types::DesktopSessionOptions;
use serde_json::{json, Value};

use crate::request::{Op, Response};
use crate::test_support::{harness_opened, Harness};

fn window(id: &str, title: &str) -> Value {
    json!({"id": id, "title": title, "app": "Notes", "pid": 4242, "x": 100, "y": 100,
           "width": 800, "height": 600, "focused": true, "elevated": null})
}

/// Window 101 whose focused element is `button`, beside `siblings`.
fn scene(button: Value, siblings: &[Value]) -> Value {
    let mut children = siblings.to_vec();
    children.push(button);
    json!({
        "windows": [window("101", "Notes")],
        "ax": {"101": {"role": "window", "title": "Notes", "bounds": {"x": 100, "y": 100, "width": 800, "height": 600},
                       "children": children}}
    })
}

fn button(extra: &Value) -> Value {
    let mut node = json!({"role": "button", "native_role": "AXButton", "title": "Save", "focused": true,
                          "bounds": {"x": 200, "y": 200, "width": 80, "height": 24}, "actions": ["press"]});
    for (key, value) in extra.as_object().expect("extra is an object") {
        node[key] = value.clone();
    }
    node
}

fn opened(overlay: &Value, report_mode: ReportMode) -> Harness {
    let options = DesktopSessionOptions { report_mode, trace: true, ..DesktopSessionOptions::default() };
    harness_opened(overlay, crate::grant::ControlSlot::new(), options)
}

fn press(harness: &mut Harness, reference: String) -> Result<Response, DesktopError> {
    harness.process(Op::AxPerform(AxPerformParams { ref_: reference, action: "press".to_owned() }))
}

fn pressed(harness: &Harness) -> usize {
    harness.sink.ops().iter().filter(|op| matches!(op, SinkOp::AxPerform { .. })).count()
}

fn report(error: &DesktopError) -> ErrorReport {
    *error.report.clone().expect("object-mode errors carry a report")
}

fn action(response: Response) -> ActionReport {
    match response {
        Response::Action(report) => *report,
        other => panic!("expected an action report, got {other:?}"),
    }
}

fn refused_fast(error: &DesktopError, started: Instant, reason: &str) {
    assert_eq!(error.code, ErrorCode::AxUnsupported, "{error}");
    let report = report(error);
    assert_eq!(report.reason.as_deref(), Some(reason));
    assert_eq!(report.disposition, Some(Disposition::NOT_DELIVERED_SAFE));
    assert!(started.elapsed() < Duration::from_secs(1), "refused after {:?}", started.elapsed());
}

#[test]
fn the_battery_refuses_a_disabled_element_at_once_and_sends_nothing() {
    // Given: a visible, still, disabled button.
    let mut harness = opened(&scene(button(&json!({"enabled": false})), &[]), ReportMode::Object);
    let reference = harness.focused_ref();
    // When
    let started = Instant::now();
    let error = press(&mut harness, reference).expect_err("refused");
    // Then: no auto-wait for a terminal state.
    refused_fast(&error, started, "disabled");
    assert_eq!(pressed(&harness), 0);
}

#[test]
fn the_battery_refuses_an_action_the_element_does_not_offer_at_once() {
    // Given
    let mut harness = opened(&scene(button(&json!({"actions": ["focus"]})), &[]), ReportMode::Object);
    let reference = harness.focused_ref();
    // When
    let started = Instant::now();
    let error = press(&mut harness, reference).expect_err("refused");
    // Then
    refused_fast(&error, started, "action_unsupported");
    assert_eq!(pressed(&harness), 0);
}

#[test]
fn the_battery_waits_for_an_element_that_appears_enabled_after_500_ms() {
    // Given: hidden and disabled until 500 ms after its first read.
    let mut harness = opened(&scene(button(&json!({"ready_after_ms": 500})), &[]), ReportMode::Object);
    let reference = harness.focused_ref();
    // When
    let started = Instant::now();
    let report = action(press(&mut harness, reference).expect("delivered after the wait"));
    // Then: the wait shows in the axResolve stage.
    assert!(started.elapsed() >= Duration::from_millis(400), "{:?}", started.elapsed());
    let waited = report.timings.and_then(|timings| timings.ax_resolve).expect("axResolve timed");
    assert!((400_000..5_000_000).contains(&waited), "axResolve {waited} us");
    assert_eq!(report.disposition, Disposition::DELIVERED_UNVERIFIED);
    assert_eq!(pressed(&harness), 1);
}

#[test]
fn the_battery_waits_until_the_bounds_hold_still_across_two_reads() {
    // Given: the first three reads move the button.
    let mut harness = opened(&scene(button(&json!({"moving_reads": 3})), &[]), ReportMode::Object);
    let reference = harness.focused_ref();
    // When
    let result = press(&mut harness, reference);
    // Then
    assert!(result.is_ok(), "{result:?}");
    assert_eq!(pressed(&harness), 1);
}

#[test]
fn an_occlusion_hit_test_that_cannot_name_the_owner_passes() {
    // Given: an overlay covers the button, and no element's window is known.
    let overlay = json!({"role": "group", "title": "Banner", "bounds": {"x": 150, "y": 150, "width": 300, "height": 40}});
    let mut scenario = scene(button(&json!({})), &[overlay]);
    scenario["ax_owner_unknown"] = json!(true);
    let mut harness = opened(&scenario, ReportMode::Object);
    let reference = harness.focused_ref();
    // When
    let result = press(&mut harness, reference);
    // Then
    assert!(result.is_ok(), "{result:?}");
    assert_eq!(pressed(&harness), 1);
}

#[test]
fn a_null_mode_session_presses_a_disabled_element_at_once() {
    // Given: protocol 1 behavior, no battery.
    let mut harness = opened(&scene(button(&json!({"enabled": false})), &[]), ReportMode::Null);
    let reference = harness.focused_ref();
    // When
    let result = press(&mut harness, reference);
    // Then
    assert!(matches!(result, Ok(Response::Unit)), "{result:?}");
    assert_eq!(pressed(&harness), 1);
}

fn opening(secure_in_target: bool) -> Value {
    let siblings = if secure_in_target {
        vec![json!({"role": "textfield", "native_role": "AXSecureTextField", "title": "Password", "value": "s",
                    "bounds": {"x": 200, "y": 300, "width": 200, "height": 24}})]
    } else {
        Vec::new()
    };
    let mut scenario = scene(button(&json!({})), &siblings);
    scenario["opens_on_write"] = json!([{
        "window": window("202", "Save changes?"),
        "ax": {"role": "sheet", "title": "Save changes?", "children": [{"role": "button", "title": "Don't Save"}]}
    }]);
    scenario
}

#[test]
fn opened_surfaces_list_a_new_sheet_with_its_ref() {
    // Given
    let mut harness = opened(&opening(false), ReportMode::Object);
    let reference = harness.focused_ref();
    // When
    let report = action(press(&mut harness, reference).expect("delivered"));
    // Then
    assert_eq!(report.opened_surfaces.len(), 1, "{:?}", report.opened_surfaces);
    let sheet = &report.opened_surfaces[0];
    assert_eq!(sheet.kind, "sheet");
    assert_eq!(sheet.title.as_deref(), Some("Save changes?"));
    assert_eq!(sheet.window_id.as_deref(), Some("202"));
    assert!(sheet.ref_.as_deref().is_some_and(|reference| reference.starts_with('e')));
}

#[test]
fn a_sheet_opened_from_a_window_holding_a_secure_field_reports_no_title() {
    // Given: the window the press targets holds a password field.
    let mut harness = opened(&opening(true), ReportMode::Object);
    let reference = harness.focused_ref();
    // When
    let report = action(press(&mut harness, reference).expect("delivered"));
    // Then: IS-12 redaction for this channel.
    assert_eq!(report.opened_surfaces.len(), 1);
    assert_eq!(report.opened_surfaces[0].kind, "sheet");
    assert_eq!(report.opened_surfaces[0].title, None);
}

#[test]
fn a_null_mode_session_reports_nothing_about_opened_surfaces() {
    // Given
    let mut harness = opened(&opening(false), ReportMode::Null);
    let reference = harness.focused_ref();
    // When / Then
    assert!(matches!(press(&mut harness, reference), Ok(Response::Unit)));
}

fn chord(keys: &str, force: bool) -> Op {
    Op::KeyChord(KeyChordParams { target: "101".to_owned(), keys: vec![keys.to_owned()], opts: None, force })
}

fn chords_sent(harness: &Harness) -> usize {
    harness.sink.ops().iter().filter(|op| matches!(op, SinkOp::KeyChord { .. })).count()
}

#[test]
fn cmd_q_is_refused_without_force_and_sent_with_it() {
    // Given
    let mut harness = opened(&scene(button(&json!({})), &[]), ReportMode::Object);
    // When
    let error = harness.process(chord("cmd+q", false)).expect_err("refused");
    let refused_sent = chords_sent(&harness);
    let forced = harness.process(chord("cmd+q", true));
    // Then
    assert_eq!(error.code, ErrorCode::InvalidKey);
    let refusal = report(&error);
    assert_eq!(refusal.reason.as_deref(), Some("dangerous_chord"));
    assert_eq!(refusal.disposition, Some(Disposition::NOT_DELIVERED_SAFE));
    assert_eq!(refused_sent, 0);
    assert!(forced.is_ok(), "{forced:?}");
    assert_eq!(chords_sent(&harness), 1);
}

#[test]
fn a_null_mode_session_sends_cmd_q_as_protocol_1_did() {
    // Given
    let mut harness = opened(&scene(button(&json!({})), &[]), ReportMode::Null);
    // When
    let result = harness.process(chord("cmd+q", false));
    // Then
    assert!(result.is_ok(), "{result:?}");
    assert_eq!(chords_sent(&harness), 1);
}

fn no_background_input() -> Value {
    let mut scenario = scene(button(&json!({})), &[]);
    scenario["capabilities"] = json!({"backgroundWindowInput": false});
    scenario
}

#[test]
fn a_background_unavailable_chord_suggests_the_foreground_rung() {
    // Given: this host cannot deliver background window input.
    let mut harness = opened(&no_background_input(), ReportMode::Object);
    // When
    let error = harness.process(chord("ctrl+s", false)).expect_err("refused");
    // Then
    assert_eq!(error.code, ErrorCode::BackgroundUnavailable);
    let next = report(&error).next_call.expect("nextCall on BackgroundUnavailable");
    assert_eq!(next.method, Method::KeyChord);
    assert_eq!(next.args["keys"], json!(["ctrl+s"]));
    assert_eq!(next.args["opts"]["deliveryMode"], json!("foreground"));
}

#[test]
fn background_unavailable_typing_suggests_reading_the_target_windows_tree_without_the_text() {
    // Given
    let mut harness = opened(&no_background_input(), ReportMode::Object);
    // When
    let error = harness
        .process(Op::TypeText(TypeTextParams { target: "101".to_owned(), text: "hunter2".to_owned(), opts: None }))
        .expect_err("refused");
    // Then
    let next = report(&error).next_call.expect("nextCall on BackgroundUnavailable");
    // The target window's tree, never the system-wide `ax.focused` (the frontmost app's field).
    assert_eq!(next.method, Method::AxSnapshot);
    assert_eq!(next.args["target"], json!("101"));
    assert!(!serde_json::to_string(&next).expect("serializes").contains("hunter2"));
}
