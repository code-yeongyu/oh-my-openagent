//! Typing into a window that shows a remote screen (plan todo 22), proven
//! over the fake's model of the macOS rules: every character is mapped
//! before anything is typed, a Screen Sharing window refuses shifted text in
//! the background with nothing sent, and a remote window takes no insertion.

use senpi_desktop_backend_fake::SinkOp;
use senpi_desktop_core::backend::AxInputMethod;
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::protocol_params::{AxQueryParams, AxTypeTextParams, TypeTextParams};
use senpi_desktop_core::protocol_results::AxInputResult;
use senpi_desktop_core::types::{AxQuery, PointerOptions};
use serde_json::json;

use crate::request::{Op, Response};
use crate::test_support::{harness, Harness};

/// Window 101's process (pid 4242 in the fixture) shows a remote screen.
fn remote(kind: &str) -> serde_json::Value {
    json!({ "remote_screens": { "4242": kind } })
}

fn type_into(text: &str, delivery: Option<&str>) -> Op {
    Op::TypeText(TypeTextParams {
        target: "101".to_owned(),
        text: text.to_owned(),
        opts: delivery.map(|mode| PointerOptions { delivery_mode: Some(mode.to_owned()), ..PointerOptions::default() }),
    })
}

/// All text the fake typed, in order (the fake posts window text in 8-character chunks).
fn typed(harness: &Harness) -> String {
    harness
        .sink
        .ops()
        .into_iter()
        .filter_map(|op| match op {
            SinkOp::TypeText { text, .. } | SinkOp::AxTypeText { text, .. } => Some(text),
            _ => None,
        })
        .collect()
}

fn element_ref(harness: &mut Harness, role: &str) -> String {
    let query = AxQuery { role: Some(role.to_owned()), ..AxQuery::default() };
    match harness.process(Op::AxQuery(AxQueryParams { target: "101".to_owned(), query })) {
        Ok(Response::Nodes(nodes)) => nodes.into_iter().next().unwrap_or_else(|| panic!("a {role}")).ref_,
        other => panic!("ax.query failed: {other:?}"),
    }
}

#[test]
fn a_character_no_key_types_refuses_the_whole_text_before_any_key() {
    let mut harness = harness(&remote("keyEvents"));
    let refused = harness.process(type_into("ab😀c", None)).unwrap_err();
    assert_eq!(refused.code, ErrorCode::InvalidKey);
    assert!(refused.message.contains("nothing was typed"), "{}", refused.message);
    assert!(typed(&harness).is_empty(), "{}", typed(&harness));
    assert_eq!(harness.audits().last().map(|audit| audit.code), Some(Some(ErrorCode::InvalidKey)));
}

#[test]
fn screen_sharing_refuses_shifted_text_in_the_background_with_nothing_sent() {
    let mut harness = harness(&remote("keyEvents"));
    let refused = harness.process(type_into("Hello", None)).unwrap_err();
    assert_eq!(refused.code, ErrorCode::BackgroundUnavailable);
    assert!(refused.message.ends_with("nothing was sent"), "{}", refused.message);
    assert!(typed(&harness).is_empty());
    // Unshifted text goes out as keys; foreground delivery (under the grant) types shifted text.
    harness.process(type_into("hello", None)).expect("types bare keys");
    harness.grant("remote typing");
    harness.process(type_into("Hello", Some("foreground"))).expect("types in the foreground");
    assert_eq!(typed(&harness), "helloHello");
}

#[test]
fn iphone_mirroring_types_shifted_text_in_the_background() {
    // iPhone Mirroring streams modifier keys in its HID reports, so Shift is held as a key.
    let mut harness = harness(&remote("hidReports"));
    harness.process(type_into("Hello World", None)).expect("types with Shift as a key");
    assert_eq!(typed(&harness), "Hello World");
}

#[test]
fn a_remote_window_takes_no_insertion_even_into_a_text_field() {
    let mut harness = harness(&remote("hidReports"));
    let reference = element_ref(&mut harness, "textarea");
    let reply = harness.process(Op::AxTypeText(AxTypeTextParams { ref_: reference.clone(), text: "hello".to_owned(), opts: None }));
    assert_eq!(reply.expect("typed"), Response::AxInput(AxInputResult { method: AxInputMethod::Keys }));
    // Still mapped in full before any key.
    let refused = harness.process(Op::AxTypeText(AxTypeTextParams { ref_: reference, text: "h😀".to_owned(), opts: None })).unwrap_err();
    assert_eq!(refused.code, ErrorCode::InvalidKey);
    assert_eq!(typed(&harness), "hello");
}

#[test]
fn a_local_window_is_unchanged() {
    let mut harness = harness(&json!({}));
    harness.process(type_into("Hello 😀", None)).expect("a local window takes the Unicode payload");
    assert_eq!(typed(&harness), "Hello 😀");
}
