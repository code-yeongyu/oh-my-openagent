//! `ax.selectText` over the fake: the located range comes back with its text,
//! a following `ax.typeText` replaces it (parity row E-2), an ambiguous match
//! is refused before anything is written, and an unanswered write is
//! unconfirmed.

use senpi_desktop_backend_fake::{AxWrite, SinkOp};
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::methods::Method;
use senpi_desktop_core::protocol_params::{AxQueryParams, AxRefParams, AxSelectTextParams, AxSetValueParams, AxTypeTextParams};
use senpi_desktop_core::protocol_results::AxTextSelection;
use senpi_desktop_core::types::AxQuery;
use serde_json::json;

use crate::request::{Op, Response};
use crate::test_support::{harness, Harness};

fn select(reference: &str, text: &str, prefix: Option<&str>, suffix: Option<&str>) -> Op {
    Op::AxSelectText(AxSelectTextParams {
        ref_: reference.to_owned(),
        text: text.to_owned(),
        prefix: prefix.map(str::to_owned),
        suffix: suffix.map(str::to_owned),
        select: None,
    })
}

fn value_of(harness: &mut Harness, reference: &str) -> Option<String> {
    match harness.process(Op::AxNode(AxRefParams { ref_: reference.to_owned() })) {
        Ok(Response::Node(node)) => node.value,
        other => panic!("ax.node failed: {other:?}"),
    }
}

/// The fixture's text area, holding "alpha beta gamma".
fn textarea(harness: &mut Harness) -> String {
    let query = AxQuery {
        role: Some("textarea".to_owned()),
        ..AxQuery::default()
    };
    let reference = match harness.process(Op::AxQuery(AxQueryParams {
        target: "101".to_owned(),
        query,
    })) {
        Ok(Response::Nodes(nodes)) => nodes.into_iter().next().expect("a textarea").ref_,
        other => panic!("ax.query failed: {other:?}"),
    };
    harness
        .process(Op::AxSetValue(AxSetValueParams {
            ref_: reference.clone(),
            value: "alpha beta gamma".to_owned(),
        }))
        .expect("set the value");
    reference
}

fn selections(harness: &Harness) -> Vec<(u32, u32)> {
    harness
        .sink
        .ops()
        .into_iter()
        .filter_map(|op| match op {
            SinkOp::AxSelectText { start, length, .. } => Some((start, length)),
            _ => None,
        })
        .collect()
}

#[test]
fn the_located_range_is_selected_and_a_following_type_replaces_it() {
    // Given
    let mut harness = harness(&json!({}));
    let reference = textarea(&mut harness);
    // When: E-2.
    let reply = harness.process(select(&reference, "beta", Some("alpha "), None));
    // Then
    assert_eq!(
        reply.expect("selected"),
        Response::TextSelection(AxTextSelection {
            start: 6,
            length: 4,
            text: "beta".to_owned(),
            focused: true,
        })
    );
    assert_eq!(selections(&harness), [(6, 4)]);
    let audit = harness.audits().pop().expect("an audit");
    assert_eq!(audit.action, Method::AxSelectText);
    assert_eq!(audit.target, "101");
    assert_eq!(audit.delivery, "background");
    assert_eq!(audit.code, None);
    assert_eq!(audit.text_length, Some(4));
    // When: typing replaces the selection.
    harness
        .process(Op::AxTypeText(AxTypeTextParams {
            ref_: reference.clone(),
            text: "BETA".to_owned(),
            opts: None,
        }))
        .expect("typed");
    // Then
    assert_eq!(value_of(&mut harness, &reference).as_deref(), Some("alpha BETA gamma"));
}

#[test]
fn a_caret_is_placed_by_context_alone() {
    let mut harness = harness(&json!({}));
    let reference = textarea(&mut harness);
    let reply = harness.process(select(&reference, "", Some("alpha "), None));
    assert_eq!(
        reply.expect("caret"),
        Response::TextSelection(AxTextSelection {
            start: 6,
            length: 0,
            text: String::new(),
            focused: true,
        })
    );
}

#[test]
fn an_ambiguous_match_is_refused_before_anything_is_selected() {
    let mut harness = harness(&json!({}));
    let reference = textarea(&mut harness);
    let reply = harness.process(select(&reference, "a", None, None));
    let error = reply.expect_err("ambiguous");
    assert_eq!(error.code, ErrorCode::AxFailed);
    assert!(error.message.contains("nothing was selected"), "{}", error.message);
    assert!(selections(&harness).is_empty());
    assert_eq!(harness.audits().pop().expect("an audit").code, Some(ErrorCode::AxFailed));
}

#[test]
fn an_unanswered_selection_write_is_unconfirmed() {
    let mut harness = harness(&json!({}));
    let reference = textarea(&mut harness);
    harness.faults.cannot_complete_next(AxWrite::AxSelectText);
    let reply = harness.process(select(&reference, "gamma", None, None));
    assert_eq!(reply.map_err(|error| error.code), Err(ErrorCode::AxUnconfirmed));
    assert_eq!(selections(&harness), [(11, 5)]);
}
