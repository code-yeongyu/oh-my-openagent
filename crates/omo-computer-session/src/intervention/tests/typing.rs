//! Row 22 on the fake: the exact `delivered{count, of}` of an interrupted text, the takeover
//! pause before a send, and a null-mode session that never pauses.

use super::*;

#[test]
fn typetext_interrupted_reports_exact_delivered_count() {
    let (backend, sink) = fake(
        r#","typing_unit_ms":10,"user_input_timeline":[{"t_ms":25,"pid":4242,"kind":"key"}]"#,
    );
    let mut session = object_session(Box::new(backend));
    let refused = session
        .type_text(params(json!({"target": "101", "text": "abcdefghij"})))
        .expect_err("the user pressed a key after the third grapheme");
    assert_eq!(wire(&refused), ("UserIntervened", None));
    assert_eq!(refused.stamps.delivered, Some(Delivered { count: 3, of: 10 }));
    assert_eq!(refused.interrupted, None, "the code's PREFIX row says it");
    assert_eq!(sink.len(), 1, "one stroke, nothing after: {:?}", sink.lines());
    assert!(sink.lines()[0].ends_with(r#"text "abc""#), "{:?}", sink.lines());
}

#[test]
fn intervention_continue_never_aborts_the_stroke() {
    let (backend, sink) = fake(
        r#","typing_unit_ms":10,"user_input_timeline":[{"t_ms":25,"pid":4242,"kind":"key"}]"#,
    );
    let mut session = Session::new(Box::new(backend));
    session
        .open(params(json!({"reportMode": "object", "intervention": "continue"})))
        .expect("open");
    session.stop_path_start(params(json!({})));
    let reply = session
        .type_text(params(json!({"target": "101", "text": "abcdefghij"})))
        .expect("continue sends every grapheme");
    assert_eq!(report(reply).delivered(), Some(omo_computer_core::report::Delivered { count: 10, of: 10 }));
    assert!(sink.lines()[0].ends_with(r#"text "abcdefghij""#));
}

#[test]
fn user_active_200ms_before_send_pauses_instead_of_sending() {
    let (backend, sink) = fake(r#","user_input_timeline":[{"t_ms":800,"pid":4242,"kind":"key"}]"#);
    backend.clock().advance(1_000);
    let mut session = object_session(Box::new(backend));
    let reply = session
        .framed_click(None)
        .expect("sends once the user paused for 1500 ms");
    let first = report(reply);
    assert_eq!(
        first.paused(),
        &[Pause {
            reason: PauseReason::UserActive,
            ms: 1_300
        }]
    );
    assert_eq!(sink.len(), 3, "sent after the pause: {:?}", sink.lines());

    let (backend, sink) = fake(r#","user_input_timeline":[{"t_ms":0,"pid":4242,"kind":"key"}]"#);
    backend.clock().advance(1_600);
    let reply = object_session(Box::new(backend))
        .framed_click(None)
        .expect("1600 ms before sends at once");
    assert!(report(reply).paused().is_empty());
    assert_eq!(sink.len(), 3);

    let steady: Vec<String> = (0..=125)
        .map(|second| format!(r#"{{"t_ms":{},"pid":4242,"kind":"key"}}"#, second * 1_000))
        .collect();
    let (backend, sink) = fake(&format!(r#","user_input_timeline":[{}]"#, steady.join(",")));
    let refused = object_session(Box::new(backend))
        .framed_click(None)
        .expect_err("the user never paused within the ceiling");
    assert_eq!(wire(&refused), ("UserIntervened", None));
    assert_eq!(refused.stamps.paused.first().map(|p| p.reason), Some(PauseReason::UserActive));
    assert!(refused.stamps.paused[0].ms > 120_000);
    assert_eq!(refused.stamps.delivered, None, "nothing was sent");
    assert!(sink.is_empty(), "{:?}", sink.lines());
}

#[test]
fn null_mode_never_pauses_a_v1_call() {
    let (backend, sink) = fake(r#","user_input_timeline":[{"t_ms":800,"pid":4242,"kind":"key"}]"#);
    let clock = backend.clock();
    clock.advance(1_000);
    let mut session = Session::new(Box::new(backend));
    session.open(params(json!({}))).expect("open");
    session.stop_path_start(params(json!({})));
    let reply = session.framed_click(None);
    assert_eq!(reply, Ok(ExecReply(None)));
    assert_eq!(clock.now_ms(), 1_000, "no wait in a null-mode session");
    assert_eq!(sink.len(), 3);
}
