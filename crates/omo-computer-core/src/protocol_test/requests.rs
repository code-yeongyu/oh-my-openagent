//! The readers carry the values the gate review found unread into their typed requests.

use serde_json::json;

use crate::listing::SurfaceKind;
use crate::methods::Method;
use crate::requests::{
    read_ax_focus, read_ax_perform, read_ax_type_text, read_click, read_hold_keys, read_hold_mouse,
    read_key_chord, read_open_system_surface, read_raise_window, read_session_open, read_type_text,
    At, ExecRequest, TraceMode, V1Verb, Verb,
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

/// `params` plus the exec members every v1 reader must carry into its request.
fn bound<T: serde::de::DeserializeOwned>(mut params: serde_json::Value) -> T {
    params.as_object_mut().expect("params object").extend(
        json!({"callId": "c7", "runGeneration": 3, "observeAfter": {"screenshot": false}})
            .as_object()
            .expect("members")
            .clone(),
    );
    serde_json::from_value(params).expect("exec params")
}

#[test]
fn v1_exec_verbs_reach_the_exec_funnel_with_their_authority() {
    let target = Some("101");
    let element = Some("s1:e4");
    let cases: Vec<(ExecRequest, V1Verb, Option<&str>, Option<&str>)> = vec![
        (
            read_type_text(bound(json!({"target": "101", "text": "hi"}))),
            V1Verb::TypeText { text: "hi".into() },
            target,
            None,
        ),
        (
            read_key_chord(bound(json!({"target": "101", "keys": ["cmd", "a"]}))),
            V1Verb::KeyChord {
                keys: vec!["cmd".into(), "a".into()],
            },
            target,
            None,
        ),
        (
            read_hold_keys(bound(
                json!({"target": "101", "keys": ["shift"], "duration": 40}),
            )),
            V1Verb::HoldKeys {
                keys: vec!["shift".into()],
                duration_ms: 40,
            },
            target,
            None,
        ),
        (
            read_hold_mouse(bound(
                json!({"target": "101", "x": 1, "y": 2, "duration": 40}),
            )),
            V1Verb::HoldMouse {
                at: At { x: 1.0, y: 2.0 },
                duration_ms: 40,
            },
            target,
            None,
        ),
        (
            read_raise_window(bound(json!({"windowId": "w9"}))),
            V1Verb::RaiseWindow {
                window: "w9".into(),
            },
            None,
            None,
        ),
        (
            read_ax_perform(bound(json!({"ref": "s1:e4", "action": "AXPress"}))),
            V1Verb::AxPerform {
                action: "AXPress".into(),
            },
            None,
            element,
        ),
        (
            read_ax_focus(bound(json!({"ref": "s1:e4"}))),
            V1Verb::AxFocus,
            None,
            element,
        ),
        (
            read_ax_type_text(bound(json!({"ref": "s1:e4", "text": "hi"}))),
            V1Verb::AxTypeText { text: "hi".into() },
            None,
            element,
        ),
        (
            read_open_system_surface(bound(json!({"kind": "sheet"}))),
            V1Verb::OpenSystemSurface {
                kind: SurfaceKind::Sheet,
            },
            None,
            None,
        ),
    ];
    assert_eq!(cases.len(), 9, "every v1 reader is covered");
    for (request, verb, aimed_at, reference) in cases {
        assert_eq!(request.verb, Verb::V1(verb), "{request:?}");
        assert_eq!(request.target.as_deref(), aimed_at, "{request:?}");
        assert_eq!(request.reference.as_deref(), reference, "{request:?}");
        assert_eq!(
            request.authority.call_id.as_deref(),
            Some("c7"),
            "{request:?} lost callId"
        );
        assert_eq!(
            request.authority.run_generation,
            Some(3),
            "{request:?} lost runGeneration"
        );
        assert!(
            request.observe_after.is_some(),
            "{request:?} lost observeAfter"
        );
    }
}
