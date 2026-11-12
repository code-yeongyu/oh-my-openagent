//! The engine builds its session with `Session::for_roots`; that session keeps the lease hooks
//! a session built with `Session::new` has (the display-awake rule of row 22, R45).

use omo_computer_core::paths::Roots;
use serde_json::json;

use super::tests::{fake, params, FramedClick};
use crate::Session;

#[test]
fn the_engine_session_keeps_the_display_awake_lease_hook() {
    let dir = tempfile::tempdir().expect("tempdir");
    let (backend, _sink) = fake("");
    let roots = Roots { state: dir.path().join("state"), runtime: dir.path().join("run") };
    let mut session = Session::for_roots(Box::new(backend), &roots);
    session.open(params(json!({"reportMode": "object"}))).expect("open");
    session.stop_path_start(params(json!({})));
    assert!(session.framed_click(None).is_ok(), "the click delivered");
    assert!(session.display_awake.get().holds_display_awake(), "an exec acquires the hold");
    session.control_grant(params(json!({ "reason": "test" })));
    session.control_release();
    assert_eq!(
        session.display_awake.get(),
        crate::intervention::DisplayAwakeHold::Released,
        "the engine session's lease end releases the hold"
    );
}
