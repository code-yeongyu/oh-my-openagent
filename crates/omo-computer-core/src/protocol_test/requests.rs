//! The readers carry the values the gate review found unread into their typed requests.

use serde_json::json;

use crate::requests::{read_click, read_session_open, TraceMode, Verb};

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
