//! `ax.keyChord` over the fake: a chord pressed in an element the backend
//! focused, the grant rule, the refusal with nothing sent when the element
//! never takes focus, an invalid chord refused before any send, and the
//! fake's own text model (parity row E-3: select all, then type).

use senpi_desktop_backend_fake::{FakeMethod, SinkOp};
use senpi_desktop_core::backend::DeliveryMode;
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::keys::KeyName;
use senpi_desktop_core::methods::Method;
use senpi_desktop_core::protocol_params::{AxKeyChordParams, AxQueryParams, AxRefParams, AxTypeTextParams};
use senpi_desktop_core::types::{AxQuery, PointerOptions};
use serde_json::json;

use crate::request::{Op, Response};
use crate::test_support::{delivery, harness, op_names, Harness};

fn press(reference: &str, keys: &[&str], opts: Option<PointerOptions>) -> Op {
    Op::AxKeyChord(AxKeyChordParams {
        ref_: reference.to_owned(),
        keys: keys.iter().map(|key| (*key).to_owned()).collect(),
        opts,
    })
}

fn chords(harness: &Harness) -> Vec<(Vec<KeyName>, DeliveryMode)> {
    harness
        .sink
        .ops()
        .into_iter()
        .filter_map(|op| match op {
            SinkOp::AxKeyChord { keys, mode, .. } => Some((keys, mode)),
            _ => None,
        })
        .collect()
}

fn value_of(harness: &mut Harness, reference: &str) -> Option<String> {
    match harness.process(Op::AxNode(AxRefParams { ref_: reference.to_owned() })) {
        Ok(Response::Node(node)) => node.value,
        other => panic!("ax.node failed: {other:?}"),
    }
}

/// The first element of `role` in window 101, so its audit target is the window.
fn element_ref(harness: &mut Harness, role: &str) -> String {
    let query = AxQuery {
        role: Some(role.to_owned()),
        ..AxQuery::default()
    };
    match harness.process(Op::AxQuery(AxQueryParams {
        target: "101".to_owned(),
        query,
    })) {
        Ok(Response::Nodes(nodes)) => nodes.into_iter().next().unwrap_or_else(|| panic!("a {role}")).ref_,
        other => panic!("ax.query failed: {other:?}"),
    }
}

#[test]
fn a_chord_goes_to_the_element_once_it_is_focused_and_is_audited_by_its_keys() {
    // Given: the fixture's Save button.
    let mut harness = harness(&json!({}));
    let reference = element_ref(&mut harness, "button");
    // When
    let reply = harness.process(press(&reference, &["cmd", "a"], None));
    // Then: the fake focused the element, pressed the chord there, one
    // truthful audit naming the keys, and the key-focus guard handed focus back.
    assert_eq!(reply.expect("pressed"), Response::Unit);
    assert_eq!(chords(&harness), [(vec![KeyName::Meta, KeyName::Char('a')], DeliveryMode::Background)]);
    let ops = harness.sink.ops();
    let focus = ops.iter().position(|op| matches!(op, SinkOp::AxFocus { .. })).expect("focused");
    let chord = ops.iter().position(|op| matches!(op, SinkOp::AxKeyChord { .. })).expect("chord");
    assert!(focus < chord, "{ops:?}");
    let audits = harness.audits();
    assert_eq!(audits.len(), 1);
    assert_eq!(audits[0].action, Method::AxKeyChord);
    assert_eq!(audits[0].target, "101");
    assert_eq!(audits[0].delivery, "background");
    assert_eq!(audits[0].code, None);
    assert_eq!(audits[0].keys.as_deref(), Some(&["cmd".to_owned(), "a".to_owned()][..]));
    assert_eq!(audits[0].text_length, None);
    assert_eq!(op_names(&harness).iter().filter(|&&name| name == "restore-key-focus").count(), 1);
}

#[test]
fn select_all_then_type_replaces_the_value() {
    // Given: a text area holding text (E-3).
    let mut harness = harness(&json!({}));
    let reference = element_ref(&mut harness, "textarea");
    harness
        .process(Op::AxTypeText(AxTypeTextParams {
            ref_: reference.clone(),
            text: "old text".to_owned(),
            opts: None,
        }))
        .expect("typed");
    // When
    harness.process(press(&reference, &["cmd", "a"], None)).expect("selected all");
    harness
        .process(Op::AxTypeText(AxTypeTextParams {
            ref_: reference.clone(),
            text: "x".to_owned(),
            opts: None,
        }))
        .expect("typed");
    // Then
    assert_eq!(value_of(&mut harness, &reference).as_deref(), Some("x"));
}

#[test]
fn foreground_element_chords_need_the_grant() {
    // Given
    let mut harness = harness(&json!({}));
    let reference = element_ref(&mut harness, "button");
    // When: foreground without a grant.
    let refused = harness.process(press(&reference, &["enter"], delivery("foreground")));
    // Then: refused before anything was pressed, and audited.
    assert_eq!(refused.map_err(|error| error.code), Err(ErrorCode::ControlRequired));
    assert!(chords(&harness).is_empty());
    assert_eq!(harness.audits()[0].code, Some(ErrorCode::ControlRequired));
    // When: the grant is live.
    harness.grant("press enter");
    let reply = harness.process(press(&reference, &["enter"], delivery("foreground")));
    // Then: pressed in the foreground, and the front window was restored.
    assert_eq!(reply.expect("pressed"), Response::Unit);
    assert_eq!(chords(&harness), [(vec![KeyName::Enter], DeliveryMode::Foreground)]);
    let last = harness.audits().pop().expect("an audit");
    assert_eq!(last.action, Method::AxKeyChord);
    assert_eq!(last.delivery, "foreground");
    assert_eq!(op_names(&harness).iter().filter(|&&name| name == "restore-front").count(), 1);
}

#[test]
fn an_element_that_never_takes_focus_gets_no_chord_and_the_refusal_names_the_focus() {
    // Given: the Save button never takes focus; the text area holds it.
    let mut harness = harness(&json!({}));
    let reference = element_ref(&mut harness, "button");
    harness.faults.refuse_focus_next(FakeMethod::AxKeyChord);
    // When: background, then foreground under the grant.
    let refused = harness.process(press(&reference, &["enter"], None)).expect_err("refused");
    harness.grant("retry in front");
    harness.faults.refuse_focus_next(FakeMethod::AxKeyChord);
    let front = harness
        .process(press(&reference, &["enter"], delivery("foreground")))
        .expect_err("refused");
    // Then: nothing pressed, rerunnable in the background, not in the
    // foreground, and the message names the window and the focused element.
    assert!(chords(&harness).is_empty(), "{:?}", harness.sink.ops());
    assert_eq!(refused.code, ErrorCode::BackgroundUnavailable);
    assert_eq!(front.code, ErrorCode::InputFailed);
    for error in [&refused, &front] {
        assert!(error.message.contains("no keys were sent"), "{}", error.message);
        assert!(error.message.contains("window 101"), "{}", error.message);
        assert!(error.message.contains("textarea") && error.message.contains("[ref=e"), "{}", error.message);
    }
    let audits = harness.audits();
    assert_eq!(audits[0].code, Some(ErrorCode::BackgroundUnavailable));
    assert_eq!(audits.last().expect("an audit").code, Some(ErrorCode::InputFailed));
}

#[test]
fn an_invalid_chord_is_refused_before_anything_is_sent() {
    // Given
    let mut harness = harness(&json!({}));
    let reference = element_ref(&mut harness, "button");
    // When: "cmd+" parses to an empty key name.
    let reply = harness.process(press(&reference, &["cmd", ""], None));
    // Then
    assert_eq!(reply.map_err(|error| error.code), Err(ErrorCode::InvalidKey));
    assert!(chords(&harness).is_empty());
    assert!(!harness.sink.ops().iter().any(|op| matches!(op, SinkOp::AxFocus { .. })));
    assert_eq!(harness.audits()[0].code, Some(ErrorCode::InvalidKey));
}

#[test]
fn a_refuse_focus_fault_queued_for_an_inserting_field_is_consumed_not_left_for_the_next_call() {
    // Given: a refuse-focus fault armed for ax.typeText on a native text
    // field, which inserts and never asks for focus.
    let mut harness = harness(&json!({}));
    let reference = element_ref(&mut harness, "textarea");
    harness.faults.refuse_focus_next(FakeMethod::AxTypeText);
    // When: the insertion consumes the fault as a visible failure.
    let error = harness
        .process(Op::AxTypeText(AxTypeTextParams {
            ref_: reference.clone(),
            text: "hello".to_owned(),
            opts: None,
        }))
        .expect_err("the armed fault is reported");
    assert_eq!(error.code, ErrorCode::AxFailed);
    assert!(error.message.contains("consumed"), "{}", error.message);
    // Then: the next call runs without it.
    harness
        .process(Op::AxTypeText(AxTypeTextParams {
            ref_: reference.clone(),
            text: "hello".to_owned(),
            opts: None,
        }))
        .expect("typed");
    assert_eq!(value_of(&mut harness, &reference).as_deref(), Some("hello"));
}

#[test]
fn the_fakes_set_value_moves_the_caret_to_the_end_of_the_new_value() {
    // Given: text typed, then the value replaced through ax.setValue.
    let mut harness = harness(&json!({}));
    let reference = element_ref(&mut harness, "textarea");
    harness
        .process(Op::AxTypeText(AxTypeTextParams {
            ref_: reference.clone(),
            text: "abc".to_owned(),
            opts: None,
        }))
        .expect("typed");
    harness
        .process(Op::AxSetValue(senpi_desktop_core::protocol_params::AxSetValueParams {
            ref_: reference.clone(),
            value: "1".to_owned(),
        }))
        .expect("set");
    // When: typing again lands after the new value, not at the old caret.
    harness
        .process(Op::AxTypeText(AxTypeTextParams {
            ref_: reference.clone(),
            text: "2".to_owned(),
            opts: None,
        }))
        .expect("typed");
    // Then
    assert_eq!(value_of(&mut harness, &reference).as_deref(), Some("12"));
}
