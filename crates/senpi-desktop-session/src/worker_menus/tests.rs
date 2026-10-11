//! The session wires the supervisor and the cancel probe into the backend's
//! menu walk, and a stop that races cancellation still reports `Suspended`.

use std::cell::Cell;
use std::sync::Arc;

use senpi_desktop_backend_fake::SinkOp;
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::protocol_params::MenuPathParams;
use senpi_desktop_safety::StopSource;
use serde_json::json;

use crate::request::Op;
use crate::test_support::harness;

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
    let op = Op::MenusSelect(MenuPathParams {
        window_id: "101".to_owned(),
        path: vec!["File".to_owned(), "Save".to_owned()],
    });
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
