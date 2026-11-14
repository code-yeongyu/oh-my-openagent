//! The gate through the session that calls it: a refused `click` or `typeText` leaves the
//! fake's recording sink empty (the sink, not a flag, is the proof), and the serialized
//! `capabilities().stopPath` carries the engine's own stop-path state over the backend's.

use omo_computer_backend_fake::{
    FakeBackend, FakeClock, FakeScenario, RecordingSink, StopPathScript,
};
use omo_computer_core::backend::Refusal;
use omo_computer_session::Session;
use serde::de::DeserializeOwned;
use serde_json::{json, Value};

fn session(pid: u32, script: StopPathScript, sink: &RecordingSink) -> Session {
    let windows = format!(
        r#"{{"windows":[{{"id":"101","title":"t","app":"Notes","pid":{pid},"x":0,"y":0,"width":800,"height":600,"focused":true,"elevated":null}}]}}"#
    );
    let scenario = FakeScenario::from_json(&windows).expect("scenario");
    let backend = FakeBackend::with_parts(scenario, FakeClock::default(), sink.clone());
    Session::new(Box::new(backend.with_stop_path(script)))
}

fn params<T: DeserializeOwned>(value: Value) -> T {
    serde_json::from_value(value).expect("params parse")
}

fn wire(refusal: Refusal) -> (&'static str, Option<&'static str>) {
    (refusal.code.wire(), refusal.reason)
}

/// Each case: the stop script, the window's pid, whether `stopPath.start` and then a
/// `stopPath.stop` run, and the refusal both exec verbs answer.
#[test]
fn every_refused_exec_leaves_the_recording_sink_empty() {
    let own = std::process::id();
    let cases = [
        (
            StopPathScript::Live,
            4242,
            false,
            false,
            ("StopPathUnavailable", "no_listener"),
        ),
        (
            StopPathScript::Deaf,
            4242,
            true,
            false,
            ("StopPathUnavailable", "deaf"),
        ),
        (StopPathScript::Live, 4242, true, true, ("Suspended", "api")),
        (
            StopPathScript::Live,
            own,
            true,
            false,
            ("ProtectedProcess", "self_target"),
        ),
    ];
    for (script, pid, start, stop, (code, reason)) in cases {
        let sink = RecordingSink::default();
        let mut session = session(pid, script, &sink);
        session.open(params(json!({}))).expect("open");
        if start {
            session.stop_path_start(params(json!({})));
        }
        if stop {
            session.stop_path_stop(params(json!({})));
        }
        let click = session.click(params(json!({ "target": "101", "x": 10, "y": 10 })));
        let text = session.type_text(params(json!({ "target": "101", "text": "hi" })));
        for refused in [click, text] {
            let refused = refused.expect_err("refused");
            assert_eq!(wire(refused.refusal), (code, Some(reason)), "{script:?}");
        }
        assert!(
            sink.is_empty(),
            "{code}{{{reason}}} sent {:?}",
            sink.lines()
        );
    }
    let sink = RecordingSink::default();
    let mut session = session(4242, StopPathScript::Live, &sink);
    session.open(params(json!({}))).expect("open");
    session.stop_path_start(params(json!({})));
    let frame = session
        .capture_frame("101", true, None)
        .expect("a frame of window 101");
    let click = json!({ "target": "101", "x": 10, "y": 10, "frameId": frame.frame_id });
    session.click(params(click)).expect("admitted");
    assert_eq!(
        sink.len(),
        3,
        "the same sink records an admitted click: {:?}",
        sink.lines()
    );
}

fn stop_path(session: &Session) -> Value {
    serde_json::to_value(session.capabilities()).expect("serializes")["stopPath"].clone()
}

#[test]
fn capabilities_stop_path_carries_the_engine_state() {
    let sink = RecordingSink::default();
    let mut live = session(4242, StopPathScript::Live, &sink);
    let open = json!({ "reportMode": "object", "allowHostRelayOnlyStop": true });
    live.open(params(open)).expect("open");
    let before = stop_path(&live);
    assert_eq!(
        (&before["allowHostRelayOnly"], &before["hostRelayLive"]),
        (&json!(true), &json!(false))
    );
    live.stop_path_heartbeat();
    assert_eq!(stop_path(&live)["hostRelayLive"], json!(true));
    live.stop_path_start(params(json!({})));
    let armed = stop_path(&live);
    assert_eq!(
        (&armed["kind"], &armed["deaf"]),
        (&json!("global"), &json!(false)),
        "{armed}"
    );

    let mut deaf = session(4242, StopPathScript::Deaf, &sink);
    deaf.open(params(json!({ "reportMode": "object" })))
        .expect("open");
    deaf.stop_path_start(params(json!({})));
    let reported = stop_path(&deaf);
    assert_eq!(
        (&reported["kind"], &reported["deaf"]),
        (&json!("none"), &json!(true)),
        "{reported}"
    );
    assert!(sink.is_empty());
}
