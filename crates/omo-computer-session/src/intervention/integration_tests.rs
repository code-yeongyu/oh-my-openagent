//! R47: where row 22's admission and send meet row 25's url policy and side-effect events, both
//! rows' behaviour holds on the same call.

use omo_computer_backend_fake::{FakeBackend, FakeClock, FakeScenario, RecordingSink, StopPathScript};
use omo_computer_core::backend::InputEvent;
use omo_computer_core::listing::SurfaceKind;
use serde_json::json;

use super::units;
use crate::Session;

fn params<T: serde::de::DeserializeOwned>(value: serde_json::Value) -> T {
    serde_json::from_value(value).expect("params parse")
}

fn bank_session(url: &str, sink: &RecordingSink) -> Session {
    let scenario = FakeScenario::from_value(&json!({
        "windows": [{ "id": "101", "title": "t", "app": "Notes", "pid": 4242, "x": 0, "y": 0,
            "width": 800, "height": 600, "focused": true, "elevated": null }],
        "browser_urls": { "101": url }
    }))
    .expect("scenario");
    let fake = FakeBackend::with_parts(scenario, FakeClock::default(), sink.clone())
        .with_stop_path(StopPathScript::Live);
    let mut session = Session::new(Box::new(fake));
    session
        .open(params(json!({ "reportMode": "object", "settings": { "url_policy": ["*.bank.example"] } })))
        .expect("open");
    session.stop_path_start(params(json!({})));
    session.capture(params(json!({ "target": "101" }))).expect("capture");
    session
}

#[test]
fn a_denied_url_keeps_its_detail_and_the_admission_stamp_on_one_call() {
    let sink = RecordingSink::default();
    let mut session = bank_session("https://pay.bank.example/x", &sink);
    let refused = session
        .click(params(json!({ "target": "101", "x": 5, "y": 5 })))
        .expect_err("a denied host");
    assert_eq!(
        (refused.refusal.code.wire(), refused.refusal.reason),
        ("ControlRequired", Some("url_policy")),
        "row 25: the consequential gate refuses"
    );
    assert_eq!(
        refused.detail.as_ref().map(|detail| detail["host"].clone()),
        Some(json!("pay.bank.example")),
        "row 25: the url detail survives admit_call"
    );
    assert!(refused.stamps.session.is_some(), "row 22: admit_call stamps the session state");
    assert!(sink.lines().iter().all(|line| !line.contains("post_input")), "nothing sent");
}

#[test]
fn each_side_effect_event_is_one_delivered_unit() {
    let events = [
        InputEvent::MenuSelect { path: vec!["File".to_owned(), "Open".to_owned()] },
        InputEvent::AppLaunch { app_key: "com.example.notes".to_owned(), activate: true },
        InputEvent::AppQuit { app_key: "com.example.notes".to_owned(), force: false },
        InputEvent::OpenSurface { kind: SurfaceKind::Menu },
    ];
    for event in &events {
        assert_eq!(units(std::slice::from_ref(event)), 1, "{event:?}");
    }
    let mixed = [events[0].clone(), InputEvent::Text("ab".to_owned())];
    assert_eq!(units(&mixed), 3, "a side effect is one unit beside a text's scalars");
}
