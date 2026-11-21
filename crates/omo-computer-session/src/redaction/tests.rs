use omo_computer_backend_fake::{FakeBackend, FakeClock, FakeScenario, RecordingSink, StopPathScript};
use serde_json::json;

use crate::Session;

fn session(scenario: &str) -> Session {
    let backend = FakeBackend::with_parts(FakeScenario::from_json(scenario).expect("scenario"), FakeClock::default(), RecordingSink::default())
        .with_stop_path(StopPathScript::Live);
    let mut session = Session::new(Box::new(backend));
    session.open(serde_json::from_value(json!({"reportMode": "object"})).expect("open")).expect("open");
    session
}

const FIELDS: &str = include_str!("../../../omo-computer-backend-fake/fixtures/v3-secure-fields.json");
const SECURE_FOCUS: &str = include_str!("../../../omo-computer-backend-fake/fixtures/v3-secure-focus-observe.json");

#[test]
fn secure_field_value_is_withheld_from_the_tree() {
    let mut session = session(FIELDS);
    let observation = session.observe(serde_json::from_value(json!({"target": "101"})).expect("params")).expect("observe");
    let reply = serde_json::to_string(&observation).expect("json");
    assert!(reply.contains("cats"), "an ordinary value is kept: {reply}");
    for secret in ["hunter2", "s3cretValue"] {
        assert!(!reply.contains(secret), "secret {secret} reached the reply: {reply}");
    }
}

#[test]
fn secure_field_observe_withholds_tree_and_frame() {
    let mut session = session(SECURE_FOCUS);
    let observation = session.observe(serde_json::from_value(json!({"target": "101"})).expect("params")).expect("observe");
    assert_eq!(observation.secure, Some(true));
    assert_eq!((observation.tree.as_deref(), observation.frame.is_some(), observation.focused.is_some()), (None, false, false));
    let reply = serde_json::to_string(&observation).expect("json");
    for secret in ["hunter2", "s3cretValue", "cats"] {
        assert!(!reply.contains(secret), "{secret} reached a private-mode reply: {reply}");
    }
}

/// R70f(1), R70g(1): a private-mode observation names the user in `nextCall`.
#[test]
fn a_private_mode_observation_names_the_user_in_next_call() {
    let mut session = session(SECURE_FOCUS);
    let observation = session.observe(serde_json::from_value(json!({"target": "101"})).expect("params")).expect("observe");
    let reply = serde_json::to_value(&observation).expect("json");
    assert_eq!(reply["nextCall"], json!("ask the user to fill the field"), "{reply}");
}

/// Acceptance 79: every Frame, Observation and ActionReport is stamped untrustedText.
#[test]
fn every_reply_is_stamped_untrusted() {
    let mut session = session(FIELDS);
    let observation = serde_json::to_value(session.observe(serde_json::from_value(json!({"target": "101"})).expect("params")).expect("observe")).expect("json");
    assert_eq!(observation["observation"], json!({"untrustedText": true}), "{observation}");
    let frame = serde_json::to_value(session.capture(serde_json::from_value(json!({"target": "101"})).expect("params")).expect("capture")).expect("json");
    assert_eq!(frame["observation"], json!({"untrustedText": true}), "{frame}");
    session.stop_path_start(serde_json::from_value(json!({})).expect("start"));
    let typed = session.type_text(serde_json::from_value(json!({"target": "101", "text": "abc"})).expect("typeText")).expect("typeText");
    let report = serde_json::to_value(typed).expect("json");
    assert_eq!(report["observation"], json!({"untrustedText": true}), "{report}");
}

/// Row 26: a secret typed into a secure field goes out as keystrokes (never through the
/// clipboard) and is echoed nowhere in the reply.
#[test]
fn secret_typing_never_uses_paste_and_never_echoes_the_value() {
    let sink = RecordingSink::default();
    let backend = FakeBackend::with_parts(FakeScenario::from_json(SECURE_FOCUS).expect("scenario"), FakeClock::default(), sink.clone())
        .with_stop_path(StopPathScript::Live);
    let mut session = Session::new(Box::new(backend));
    session.open(serde_json::from_value(json!({"reportMode": "object"})).expect("open")).expect("open");
    session.stop_path_start(serde_json::from_value(json!({})).expect("start"));
    let reply = session.type_text(serde_json::from_value(json!({"target": "101", "text": "hunter2"})).expect("typeText"));
    let text = format!("{reply:?}");
    assert!(!text.contains("hunter2"), "the secret reached the reply: {text}");
    let lines = sink.lines();
    assert!(!lines.iter().any(|line| line.contains("clipboard")), "no paste route: {lines:?}");
}

/// d-safety.md 'Per-app scope' (FOLD-13 k-safety row 3): a window-targeted read of a denied app is
/// refused like its exec, with no tree and no frame in any reply.
#[test]
fn observe_on_a_denied_app_window_is_refused_with_no_tree_and_no_frame() {
    let mut scenario: serde_json::Value = serde_json::from_str(FIELDS).expect("scenario json");
    scenario["consent"] = json!({ "stopHotkey": null, "apps": { "deny": ["Notes"] } });
    let mut session = session(&scenario.to_string());
    let refused = session.observe(serde_json::from_value(json!({"target": "101"})).expect("params")).expect_err("denied");
    assert_eq!((refused.refusal.code.wire(), refused.refusal.reason), ("ControlRequired", Some(omo_computer_core::error::Reason::DeniedApp)));
    let text = format!("{refused:?}");
    assert!(!text.contains("cats") && !text.contains("hunter2"), "no tree content: {text}");
}

/// d-safety.md 'Per-app scope' / d-a11y-model.md 'Capture masking' (G3): a display or desktop frame
/// is not app-scoped, so it is served while a denied app is visible on it, and it says it is not
/// redacted (`redaction: "none"`, plan owner 2026-11-16) so no caller believes a secure field on it
/// was masked (IS-6); it carries no `secure` member.
#[test]
fn display_frame_with_a_denied_app_visible_states_its_pixel_limit() {
    let mut scenario: serde_json::Value = serde_json::from_str(FIELDS).expect("scenario json");
    scenario["consent"] = json!({ "stopHotkey": null, "apps": { "deny": ["Notes"] } });
    let mut session = session(&scenario.to_string());
    for target in ["desktop", "display:active"] {
        let frame = serde_json::to_value(session.capture(serde_json::from_value(json!({"target": target})).expect("params")).expect("the frame is served"))
            .expect("json");
        assert_eq!(frame["redaction"], json!("none"), "{target}: {frame}");
        assert!(frame.get("secure").is_none(), "{target}: {frame}");
    }
}
