//! Review M3 of #13347 at 4344305414: the app a window belongs to is bound to its executable
//! path as well as its code identity, so an app approved by path alone (A-IS-61) admits only the
//! window whose executable is that path. Two windows with the same app name but different
//! executables never share the binding, and a window whose executable cannot be read is refused
//! with the typed `identity_changed`, before its menu is read.

use std::path::PathBuf;

use omo_computer_backend_fake::{FakeBackend, FakeClock, FakeScenario, RecordingSink, StopPathScript};
use omo_computer_core::error::Reason;
use serde_json::{json, Value};

use crate::Session;

fn session() -> Session {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../omo-computer-backend-fake/fixtures/menus.json");
    let mut scenario: Value = serde_json::from_str(&std::fs::read_to_string(path).expect("fixture")).expect("fixture json");
    let window = |id: &str, pid: u32| json!({ "id": id, "title": "Editor", "app": "Code", "pid": pid, "x": 100, "y": 120,
        "width": 800, "height": 600, "focused": false, "elevated": null });
    scenario["windows"].as_array_mut().expect("windows").extend([window("102", 4343), window("103", 4444)]);
    scenario["executable_path"] = json!({ "4242": "/apps/code", "4343": "/elsewhere/code" });
    scenario["consent"] = json!({ "stopHotkey": null, "apps": { "allow": [{ "appKey": "Code", "path": "/apps/code" }] } });
    let fake = FakeBackend::with_parts(FakeScenario::from_value(&scenario).expect("scenario"), FakeClock::default(), RecordingSink::default())
        .with_stop_path(StopPathScript::Live);
    let mut session = Session::new(Box::new(fake));
    session.open(serde_json::from_value(json!({})).expect("open")).expect("open");
    session
}

#[test]
fn a_path_bound_app_admits_only_the_window_whose_executable_is_that_path() {
    let mut s = session();
    s.menu_items(serde_json::from_value(json!({ "target": "101" })).expect("params")).expect("the approved executable's window");
    for window in ["102", "103"] {
        let refused = s.menu_items(serde_json::from_value(json!({ "target": window })).expect("params")).expect_err("another executable");
        assert_eq!(
            (refused.refusal.code.wire(), refused.refusal.reason),
            ("ControlRequired", Some(Reason::IdentityChanged)),
            "window {window}: the same app name under another or an unreadable executable is not the approved app"
        );
    }
}
