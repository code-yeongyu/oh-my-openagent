//! `ax.typeText` over the fake: insertion into a native text field, keys into
//! an element the backend focused, the grant rule, and an unanswered write.

use senpi_desktop_backend_fake::{AxWrite, SinkOp};
use senpi_desktop_core::backend::{AxInputMethod, DeliveryMode};
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::methods::Method;
use senpi_desktop_core::protocol_params::{AxQueryParams, AxRefParams, AxTypeTextParams};
use senpi_desktop_core::protocol_results::AxInputResult;
use senpi_desktop_core::types::{AxQuery, PointerOptions};
use serde_json::json;

use crate::request::{Op, Response};
use crate::test_support::{delivery, harness, op_names, Harness};

fn type_into(reference: &str, text: &str, opts: Option<PointerOptions>) -> Op {
    Op::AxTypeText(AxTypeTextParams {
        ref_: reference.to_owned(),
        text: text.to_owned(),
        opts,
    })
}

fn typed(harness: &Harness) -> Vec<(String, AxInputMethod)> {
    harness
        .sink
        .ops()
        .into_iter()
        .filter_map(|op| match op {
            SinkOp::AxTypeText { text, method, .. } => Some((text, method)),
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
fn text_is_inserted_into_a_native_text_field_and_audited_as_delivered() {
    // Given: the fixture's focused text area, empty.
    let mut harness = harness(&json!({}));
    let reference = element_ref(&mut harness, "textarea");
    // When
    let reply = harness.process(type_into(&reference, "hello", None));
    // Then: inserted in one write, the value reads back, one truthful audit,
    // and the key-focus guard handed focus back.
    assert_eq!(
        reply.expect("typed"),
        Response::AxInput(AxInputResult {
            method: AxInputMethod::Inserted
        })
    );
    assert_eq!(typed(&harness), [("hello".to_owned(), AxInputMethod::Inserted)]);
    assert_eq!(value_of(&mut harness, &reference).as_deref(), Some("hello"));
    let audits = harness.audits();
    assert_eq!(audits.len(), 1);
    assert_eq!(audits[0].action, Method::AxTypeText);
    assert_eq!(audits[0].target, "101");
    assert_eq!(audits[0].delivery, "background");
    assert_eq!(audits[0].code, None);
    assert_eq!(audits[0].text_length, Some(5));
    assert_eq!(audits[0].text_delivered, Some(5));
    assert_eq!(op_names(&harness).iter().filter(|&&name| name == "restore-key-focus").count(), 1);
}

#[test]
fn text_for_an_element_that_takes_no_insertion_goes_as_keys_once_it_is_focused() {
    // Given: the Save button, which is no text field.
    let mut harness = harness(&json!({}));
    let reference = element_ref(&mut harness, "button");
    // When
    let reply = harness.process(type_into(&reference, "ok", None));
    // Then: the fake focused the element and typed into it.
    assert_eq!(
        reply.expect("typed"),
        Response::AxInput(AxInputResult {
            method: AxInputMethod::Keys
        })
    );
    assert_eq!(typed(&harness), [("ok".to_owned(), AxInputMethod::Keys)]);
    let focused = harness
        .sink
        .ops()
        .iter()
        .any(|op| matches!(op, SinkOp::AxFocus { .. }));
    assert!(focused, "{:?}", harness.sink.ops());
    assert_eq!(harness.audits()[0].text_delivered, Some(2));
}

#[test]
fn foreground_element_typing_needs_the_grant() {
    // Given
    let mut harness = harness(&json!({}));
    let reference = element_ref(&mut harness, "textarea");
    // When: foreground without a grant.
    let refused = harness.process(type_into(&reference, "hello", delivery("foreground")));
    // Then: refused before anything was typed, and audited.
    assert_eq!(refused.map_err(|error| error.code), Err(ErrorCode::ControlRequired));
    assert!(typed(&harness).is_empty());
    assert_eq!(harness.audits()[0].code, Some(ErrorCode::ControlRequired));
    // When: the grant is live.
    harness.grant("fill the form");
    let reply = harness.process(type_into(&reference, "hello", delivery("foreground")));
    // Then: typed in the foreground, and the front window was restored.
    assert!(reply.is_ok(), "{reply:?}");
    let last = harness.audits().pop().expect("an audit");
    assert_eq!(last.action, Method::AxTypeText);
    assert_eq!(last.delivery, "foreground");
    assert_eq!(op_names(&harness).iter().filter(|&&name| name == "restore-front").count(), 1);
    let modes: Vec<DeliveryMode> = harness
        .sink
        .ops()
        .into_iter()
        .filter_map(|op| match op {
            SinkOp::AxTypeText { mode, .. } => Some(mode),
            _ => None,
        })
        .collect();
    assert_eq!(modes, [DeliveryMode::Foreground]);
}

#[test]
fn an_element_that_never_takes_focus_gets_no_keys_and_the_refusal_names_the_focus() {
    // Given: the Save button never takes focus; the text area holds it.
    let mut harness = harness(&json!({}));
    let reference = element_ref(&mut harness, "button");
    harness.faults.refuse_focus_next();
    // When: background, then foreground under the grant.
    let refused = harness.process(type_into(&reference, "ok", None)).expect_err("refused");
    harness.grant("retry in front");
    harness.faults.refuse_focus_next();
    let front = harness
        .process(type_into(&reference, "ok", delivery("foreground")))
        .expect_err("refused");
    // Then: nothing typed, rerunnable in the background, not in the foreground,
    // and the message names the window and the focused element with a ref.
    assert!(typed(&harness).is_empty(), "{:?}", harness.sink.ops());
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
fn an_unanswered_insertion_is_unconfirmed_after_it_landed() {
    // Given: the app never answers the write.
    let mut harness = harness(&json!({}));
    let reference = element_ref(&mut harness, "textarea");
    harness.faults.cannot_complete_next(AxWrite::AxTypeText);
    // When
    let reply = harness.process(type_into(&reference, "draft", None));
    // Then: the write landed, the call says the outcome is unknown.
    assert_eq!(reply.map_err(|error| error.code), Err(ErrorCode::AxUnconfirmed));
    assert_eq!(value_of(&mut harness, &reference).as_deref(), Some("draft"));
    assert_eq!(harness.audits()[0].code, Some(ErrorCode::AxUnconfirmed));
}
