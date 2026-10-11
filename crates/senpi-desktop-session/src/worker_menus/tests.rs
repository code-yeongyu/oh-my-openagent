//! The session wires the supervisor and the cancel probe into the backend's
//! menu walk, and a stop that races cancellation still reports `Suspended`.

use std::cell::Cell;
use std::sync::Arc;

use senpi_desktop_backend_fake::SinkOp;
use senpi_desktop_core::backend::DeliveryMode;
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::protocol_params::MenuSelectParams;
use senpi_desktop_safety::StopSource;
use serde_json::json;

use crate::request::Op;
use crate::test_support::{harness, Harness};

#[test]
fn a_stop_racing_cancellation_mid_walk_reports_suspended_and_selects_nothing() {
    // Given: admission and the transaction's own stop check pass; the third
    // probe is the backend's first menu-level check, where a stop races the
    // cancellation
    let mut harness = harness(&json!({
        "menus": { "101": [{ "title": "File", "children": [{ "title": "Save" }] }] }
    }));
    let supervisor = Arc::clone(&harness.supervisor);
    let calls = Cell::new(0);
    let racing = || {
        calls.set(calls.get() + 1);
        if calls.get() < 3 {
            return false;
        }
        supervisor.trigger_stop(StopSource::Hotkey);
        true
    };
    let op = select("101", None);
    // When
    let reply = harness.worker.process(op, &racing);
    // Then: suspension wins, and no menu command reached the backend
    assert_eq!(reply.map_err(|error| error.code), Err(ErrorCode::Suspended));
    assert!(calls.get() >= 3, "the walk consulted the probe: {}", calls.get());
    assert!(
        !harness
            .sink
            .ops()
            .iter()
            .any(|op| matches!(op, SinkOp::MenuSelect { .. })),
        "{:?}",
        harness.sink.ops()
    );
}

fn select(window: &str, delivery: Option<&str>) -> Op {
    Op::MenusSelect(MenuSelectParams {
        window_id: window.to_owned(),
        path: vec!["File".to_owned(), "Save".to_owned()],
        delivery_mode: delivery.map(str::to_owned),
    })
}

fn file_save() -> Harness {
    harness(&json!({
        "menus": { "101": [{ "title": "File", "children": [{ "title": "Save" }] }] }
    }))
}

fn selected(harness: &Harness) -> Vec<DeliveryMode> {
    harness
        .sink
        .ops()
        .into_iter()
        .filter_map(|op| match op {
            SinkOp::MenuSelect { delivery, .. } => Some(delivery),
            _ => None,
        })
        .collect()
}

#[test]
fn a_foreground_menu_select_without_the_grant_is_refused_and_dispatches_nothing() {
    // Given: no control grant (#9888)
    let mut harness = file_save();
    // When
    let reply = harness.process(select("101", Some("foreground")));
    // Then
    assert_eq!(reply.map_err(|error| error.code), Err(ErrorCode::ControlRequired));
    assert_eq!(selected(&harness), Vec::<DeliveryMode>::new());
}

#[test]
fn a_granted_foreground_menu_select_reaches_the_backend_as_foreground() {
    // Given
    let mut harness = file_save();
    harness.grant("save the document");
    // When
    let reply = harness.process(select("101", Some("foreground")));
    // Then
    assert!(reply.is_ok(), "{reply:?}");
    assert_eq!(selected(&harness), vec![DeliveryMode::Foreground]);
}

#[test]
fn an_omitted_delivery_stays_background_and_needs_no_grant() {
    // Given: no grant; an omitted delivery never becomes foreground (B5 decision 2)
    let mut harness = file_save();
    // When
    let reply = harness.process(select("101", None));
    // Then
    assert!(reply.is_ok(), "{reply:?}");
    assert_eq!(selected(&harness), vec![DeliveryMode::Background]);
}

#[test]
fn a_revoked_grant_refuses_the_next_foreground_menu_select() {
    // Given
    let mut harness = file_save();
    harness.grant("save the document");
    harness.process(Op::ControlRevoke).expect("revokes");
    // When
    let reply = harness.process(select("101", Some("foreground")));
    // Then
    assert_eq!(reply.map_err(|error| error.code), Err(ErrorCode::ControlRequired));
    assert_eq!(selected(&harness), Vec::<DeliveryMode>::new());
}
