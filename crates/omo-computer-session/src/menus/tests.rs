use std::path::PathBuf;

use omo_computer_backend_fake::{FakeBackend, FakeClock, FakeMenuNode, FakeScenario, RecordingSink, StopPathScript};
use omo_computer_core::listing::SurfaceKind;
use serde_json::{json, Value};

use crate::Session;

fn fixture(name: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../omo-computer-backend-fake/fixtures").join(name);
    serde_json::from_str(&std::fs::read_to_string(path).expect("fixture")).expect("fixture json")
}

fn session(scenario: Value, open: Value, sink: &RecordingSink) -> (Session, FakeBackend) {
    let scenario = FakeScenario::from_value(&scenario).expect("scenario");
    let fake = FakeBackend::with_parts(scenario, FakeClock::default(), sink.clone()).with_stop_path(StopPathScript::Live);
    let mut session = Session::new(Box::new(fake.handle()));
    session.open(params(open)).expect("open");
    session.stop_path_start(params(json!({})));
    (session, fake)
}

fn params<T: serde::de::DeserializeOwned>(value: Value) -> T {
    serde_json::from_value(value).expect("params")
}

fn sent(sink: &RecordingSink) -> Vec<String> {
    sink.lines().into_iter().filter(|line| line.starts_with("post_input")).collect()
}

#[test]
fn menus_imported_scenario_lists_the_fixture_tree() {
    let sink = RecordingSink::default();
    let (mut s, _) = session(fixture("menus.json"), json!({}), &sink);
    let listed = s.menu_items(params(json!({ "target": "101" }))).expect("menu items");
    let wire = serde_json::to_value(&listed).expect("wire");
    let labels: Vec<&str> = wire["items"].as_array().expect("items").iter().map(|i| i["label"].as_str().unwrap_or("")).collect();
    assert_eq!(labels, ["File", "Save", "Export…", "PDF", "Edit", "Undo", "View"], "the separator is not an item");
    assert_eq!(wire["items"][1], json!({ "label": "Save", "enabled": true, "checked": false, "accelerator": "Cmd+S",
        "submenu": false, "path": ["File", "Save"], "observation": { "untrustedText": true } }));
    assert_eq!(wire["items"][4]["enabled"], json!(false));
    assert_eq!(wire["items"][6]["checked"], json!(true));
    assert_eq!(wire["observation"], json!({ "untrustedText": true }));
    let under = s.menu_items(params(json!({ "target": "101", "path": ["File", "Export…"] }))).expect("submenu");
    assert_eq!(serde_json::to_value(&under).expect("wire")["items"][0]["path"], json!(["File", "Export…", "PDF"]));
    assert!(sink.lines().is_empty(), "a listing sends, raises and focuses nothing: {:?}", sink.lines());
}

#[test]
fn menu_select_by_exact_label_only() {
    let sink = RecordingSink::default();
    let (mut s, _) = session(fixture("menus.json"), json!({}), &sink);
    let near = s.menu_select(params(json!({ "target": "101", "path": ["File", "Sav"] })));
    assert_eq!(near.map_err(|r| r.refusal.code.wire()), Err("StaleRef"));
    assert!(sent(&sink).is_empty());
    assert!(s.menu_select(params(json!({ "target": "101", "path": ["File", "Save"] }))).is_ok());
    assert_eq!(sent(&sink).len(), 1);
    assert!(sent(&sink)[0].ends_with(r#"menu_select path="File > Save""#), "{:?}", sent(&sink));
}

#[test]
fn menu_relabelled_between_listing_and_select_is_not_activated() {
    let sink = RecordingSink::default();
    let (mut s, fake) = session(fixture("menus.json"), json!({}), &sink);
    s.menu_items(params(json!({ "target": "101" }))).expect("listed");
    let relabelled: Vec<FakeMenuNode> = serde_json::from_value(json!([
        { "title": "File", "children": [{ "title": "Save All" }, { "title": "Save", "enabled": false }] }
    ]))
    .expect("menus");
    fake.set_menus("101", relabelled);
    let select = s.menu_select(params(json!({ "target": "101", "path": ["File", "Save"] })));
    assert_eq!(select.map_err(|r| r.refusal.code.wire()), Err("StaleRef"));
    assert!(sent(&sink).is_empty(), "never activates another item: {:?}", sent(&sink));
}

#[test]
fn menu_items_on_a_denied_app_is_refused() {
    let mut scenario = fixture("menus.json");
    scenario["consent"] = json!({ "apps": { "deny": ["Code"] } });
    let sink = RecordingSink::default();
    let (mut s, _) = session(scenario, json!({}), &sink);
    let refused = s.menu_items(params(json!({ "target": "101" }))).expect_err("denied");
    assert_eq!((refused.refusal.code.wire(), refused.refusal.reason), ("ControlRequired", Some("denied_app")));
    assert_eq!(refused.detail.map(|d| d["app"].clone()), Some(json!("Code")));
    assert!(sink.lines().is_empty());
}

#[test]
fn apps_list_records_carry_identity() {
    let sink = RecordingSink::default();
    let (mut s, _) = session(fixture("v3-apps.json"), json!({}), &sink);
    let apps = serde_json::to_value(s.apps_list().expect("apps")).expect("wire");
    assert_eq!(apps[0]["appKey"], json!("com.example.notes"));
    assert_eq!(apps[0]["source"], json!("running"));
    assert_eq!(apps[0]["identity"], json!({ "teamId": "TEAM123456", "cdhash": "0123456789abcdef0123456789abcdef01234567" }));
    assert_eq!(apps[1]["source"], json!("launch_services"));
    assert!(apps[1].get("identity").is_none(), "no pid, no readable identity");
}

#[test]
fn apps_open_of_a_denied_app_launches_nothing() {
    let mut scenario = fixture("v3-apps.json");
    scenario["consent"] = json!({ "apps": { "deny": ["com.example.mail"] } });
    let sink = RecordingSink::default();
    let (mut s, _) = session(scenario, json!({}), &sink);
    let refused = s.apps_open(params(json!({ "target": "Mail" }))).expect_err("denied");
    assert_eq!(refused.refusal.reason, Some("denied_app"));
    assert_eq!(s.apps_open(params(json!({ "target": "nope" }))).map_err(|r| r.refusal.reason), Err(Some("app_unknown")));
    assert!(sent(&sink).is_empty());
    s.apps_open(params(json!({ "target": "com.example.notes" }))).expect("an allowed app launches");
    assert!(sent(&sink)[0].ends_with(r#"app_launch "com.example.notes" activate=false"#), "{:?}", sent(&sink));
}

#[test]
fn surface_dock_observe_returns_fixture_tree() {
    let sink = RecordingSink::default();
    let (mut s, _) = session(fixture("v3-surfaces.json"), json!({}), &sink);
    let tree = s.surface_observe(SurfaceKind::Dock).expect("dock tree");
    let titles: Vec<Option<&str>> = tree.iter().map(|e| e.title.as_deref()).collect();
    assert_eq!(titles, [Some("Dock"), Some("Finder"), Some("Notes")]);
    s.open_system_surface(SurfaceKind::Dock).expect("opens with no window and no grant");
    assert!(sent(&sink)[0].ends_with("open_surface dock"), "{:?}", sent(&sink));
}

#[test]
fn unsupported_surface_is_unavailable_not_delivered() {
    let sink = RecordingSink::default();
    let (mut s, _) = session(fixture("v3-surfaces.json"), json!({}), &sink);
    let refused = s.surface(SurfaceKind::StartMenu).expect_err("not served");
    assert_eq!((refused.refusal.code.wire(), refused.refusal.reason), ("Internal", Some("surface_unsupported")));
    assert_eq!(refused.refusal.computer_code().map(|c| c.wire()), Ok("COMPUTER_UNAVAILABLE"));
    assert_eq!(refused.detail.map(|d| d["surface"].clone()), Some(json!("start_menu")));
    assert!(s.open_system_surface(SurfaceKind::StartMenu).is_err());
    assert!(sink.lines().is_empty(), "{:?}", sink.lines());
}

fn bank(urls: Value, policy: Value) -> (Session, RecordingSink) {
    let mut scenario = fixture("v3-browser-urls.json");
    scenario["browser_urls"] = urls;
    let sink = RecordingSink::default();
    let (s, _) = session(scenario, json!({ "reportMode": "object", "settings": { "url_policy": policy } }), &sink);
    (s, sink)
}

fn click(s: &mut Session) -> Result<omo_computer_core::results::ExecReply, crate::Refused> {
    s.click(params(json!({ "target": "101", "x": 5, "y": 5 })))
}

#[test]
fn url_policy_denied_host_refuses_before_send() {
    let (mut s, sink) = bank(json!({ "101": "https://pay.bank.example/x" }), json!(["*.bank.example"]));
    let refused = click(&mut s).expect_err("denied host");
    assert_eq!((refused.refusal.code.wire(), refused.refusal.reason), ("ControlRequired", Some("url_policy")));
    assert_eq!(refused.detail.map(|d| (d["host"].clone(), d["app"].clone())), Some((json!("pay.bank.example"), json!("Notes"))));
    assert!(sent(&sink).is_empty());
    let (mut ok, sink) = bank(json!({ "101": "https://docs.example" }), json!(["*.bank.example"]));
    assert!(click(&mut ok).is_ok());
    assert_eq!(sent(&sink).len(), 3);
}

#[test]
fn url_policy_unreadable_delivers_stamped_unknown() {
    let (mut s, sink) = bank(json!({ "101": null }), json!(["*.bank.example"]));
    let report = serde_json::to_value(click(&mut s).expect("delivered")).expect("report");
    assert_eq!(report["urlPolicy"], json!("unknown"));
    assert_eq!(sent(&sink).len(), 3);
    let (mut readable, _) = bank(json!({ "101": "https://docs.example" }), json!(["*.bank.example"]));
    assert!(serde_json::to_value(click(&mut readable).expect("delivered")).expect("report").get("urlPolicy").is_none());
}

#[test]
fn url_policy_empty_table_skips_the_read() {
    let (mut s, sink) = bank(json!({ "101": "https://pay.bank.example/x" }), json!([]));
    let report = serde_json::to_value(click(&mut s).expect("never refuses")).expect("report");
    assert!(report.get("urlPolicy").is_none());
    assert_eq!(sent(&sink).len(), 3);
}

fn apps_scenario(extra_app: Value) -> Value {
    let mut scenario = fixture("v3-apps.json");
    scenario["apps"].as_array_mut().expect("apps").push(extra_app);
    scenario
}

#[test]
fn apps_quit_protected_process() {
    let sink = RecordingSink::default();
    let shell = json!({ "app_key": "gnome-shell", "name": "GNOME Shell", "pid": 4444, "running": true, "source": "running" });
    let (mut s, _) = session(apps_scenario(shell), json!({}), &sink);
    for force in [false, true] {
        let refused = s
            .apps_quit(params(json!({ "target": "gnome-shell", "force": force })))
            .expect_err("a protected process is never quit");
        assert_eq!(refused.refusal.code.wire(), "ProtectedProcess", "force={force}");
        assert!(sent(&sink).is_empty(), "nothing sent: {:?}", sent(&sink));
    }
}

#[test]
fn apps_quit_unprotected_delivered_verified() {
    let sink = RecordingSink::default();
    let (mut s, _) = session(fixture("v3-apps.json"), json!({ "reportMode": "object" }), &sink);
    let reply = s.apps_quit(params(json!({ "target": "com.example.notes" }))).expect("quit");
    let report = serde_json::to_value(&reply).expect("report");
    assert_eq!(report["delivered"], json!({ "count": 1, "of": 1 }));
    assert_eq!(sent(&sink).len(), 1);
    assert!(sent(&sink)[0].ends_with(r#"app_quit "com.example.notes" force=false"#), "{:?}", sent(&sink));
}

#[test]
fn apps_list_returns_every_running_app_with_its_identity_key() {
    let sink = RecordingSink::default();
    let (mut s, _) = session(fixture("v3-apps.json"), json!({}), &sink);
    let apps = s.apps_list().expect("apps");
    let running: Vec<&str> = apps.iter().filter(|a| a.running).map(|a| a.app_key.as_str()).collect();
    assert_eq!(running, ["com.example.notes"], "every running app is listed");
    let notes = apps.iter().find(|a| a.running).expect("the running app");
    assert_eq!(notes.identity.as_ref().and_then(|id| id.cdhash.as_deref()), Some("0123456789abcdef0123456789abcdef01234567"));
    assert!(apps.iter().any(|a| !a.running), "installed-but-not-running apps are listed too");
    assert!(sink.lines().is_empty(), "a listing sends nothing");
}
