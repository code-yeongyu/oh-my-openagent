//! The readers carry the values the gate review found unread into their typed requests.

use serde_json::json;

use crate::methods::Method;
use crate::requests::{
    read_ax_focus, read_ax_perform, read_click, read_session_open, read_type_text, TraceMode,
    V1Verb, Verb,
};

#[test]
fn session_open_reads_key_priming_and_trace() {
    let params = serde_json::from_value(json!({
        "macosKeyPriming": "on", "trace": "full", "settings": {"trace": true, "macos_key_priming": false, "mcp": {"tier": "exec"}}
    }))
    .expect("session.open params");
    let opened = read_session_open(params);
    assert_eq!(opened.key_priming, Some(true));
    assert_eq!(opened.trace, Some(TraceMode::Full));
    let config = opened.config.expect("settings read");
    assert_eq!(config.artifacts.trace, Some(TraceMode::Jsonl));
    assert_eq!(config.input.macos_key_priming, Some(false));
    assert_eq!(config.host.mcp_tier, Some(crate::settings::Tier::Exec));
    let quiet = read_session_open(serde_json::from_value(json!({"trace": false})).expect("params"));
    assert_eq!(
        (quiet.trace, quiet.key_priming),
        (Some(TraceMode::Off), None)
    );
}

#[test]
fn click_reads_force_into_the_send_policy() {
    let forced = read_click(
        serde_json::from_value(
            json!({"target": "101", "x": 1, "y": 2, "force": true, "callId": "c1"}),
        )
        .expect("click"),
    );
    assert!(forced.policy.force);
    assert_eq!(forced.authority.call_id.as_deref(), Some("c1"));
    assert!(matches!(forced.verb, Verb::Click { at: Some(_), .. }));
    let plain = read_click(serde_json::from_value(json!({"ref": "s1:e2"})).expect("click"));
    assert!(!plain.policy.force);
    assert_eq!(plain.reference.as_deref(), Some("s1:e2"));
}

#[test]
fn a_lone_coordinate_is_refused_not_dropped() {
    for method in [Method::Click, Method::MouseDown] {
        for lone in [
            json!({"target": "101", "x": 5}),
            json!({"target": "101", "y": 5}),
        ] {
            assert!(
                method.validate_params(lone.clone()).is_err(),
                "{} accepted the lone coordinate {lone}",
                method.spec().name
            );
        }
        for whole in [
            json!({"target": "101", "x": 5, "y": 6}),
            json!({"target": "101"}),
        ] {
            method
                .validate_params(whole.clone())
                .unwrap_or_else(|error| panic!("{} refused {whole}: {error}", method.spec().name));
        }
    }
}

#[test]
fn v1_exec_verbs_reach_the_exec_funnel_with_their_authority() {
    let bound = json!({"callId": "c7", "runGeneration": 3, "observeAfter": {"screenshot": false}});
    let with = |mut params: serde_json::Value| {
        params
            .as_object_mut()
            .expect("params object")
            .extend(bound.as_object().expect("members").clone());
        params
    };
    let focus =
        read_ax_focus(serde_json::from_value(with(json!({"ref": "s1:e4"}))).expect("exec params"));
    assert_eq!(focus.verb, Verb::V1(V1Verb::AxFocus));
    assert_eq!(focus.reference.as_deref(), Some("s1:e4"));
    let perform = read_ax_perform(
        serde_json::from_value(with(json!({"ref": "s1:e4", "action": "AXPress"})))
            .expect("exec params"),
    );
    let typed = read_type_text(
        serde_json::from_value(with(json!({"target": "101", "text": "hi"}))).expect("exec params"),
    );
    assert_eq!(typed.target.as_deref(), Some("101"));
    for request in [focus, perform, typed] {
        assert_eq!(request.authority.call_id.as_deref(), Some("c7"));
        assert_eq!(request.authority.run_generation, Some(3));
        assert!(
            request.observe_after.is_some(),
            "{request:?} lost observeAfter"
        );
    }
}
