use std::sync::{Arc, Mutex, OnceLock};

use omo_computer_core::backend::{Backend, InputEvent, Refusal};
use omo_computer_core::error::{EngineCode, Reason};
use serde_json::json;

use crate::presence::look::{Action, CursorLook};
use crate::presence::reports::{CursorPlacement, CursorReport, CursorReports};

use super::{Probe, Run, SCENARIO, click, params, wire};

struct FakeRenderer {
    reports: CursorReports,
    drawn: Option<Arc<CursorReport>>,
}

impl FakeRenderer {
    fn held(reports: CursorReports) -> Self {
        Self {
            reports,
            drawn: None,
        }
    }

    fn tick(&mut self) -> Option<&CursorReport> {
        self.drawn = self.reports.latest();
        self.drawn.as_deref()
    }
}

#[test] // [ADP-61]
fn cursor_carries_the_session_colour_and_the_action_badge() {
    let run = Run::new();
    let mut session = run.session(Box::new(run.fake()));
    let mut renderer = FakeRenderer::held(session.cursor_reports().expect("open feed"));

    session
        .type_text(params(
            json!({"target": "101", "text": "not a cursor payload"}),
        ))
        .expect("type");
    let colour = CursorLook::shipped().session_colours[0].as_str();
    assert_eq!(
        renderer.tick(),
        Some(&CursorReport {
            colour,
            badge: Action::Text,
            placement: CursorPlacement::BadgeOnly(None),
        }),
        "initial text reaches the renderer without inventing a position"
    );

    session.click(click("aim")).expect("click");
    let aimed = renderer.tick().expect("click report").clone();
    assert_eq!(aimed.colour, colour);
    assert_eq!(aimed.badge, Action::Click);
    let CursorPlacement::Aim(point) = aimed.placement else {
        panic!("click carries the admitted point")
    };

    session
        .type_text(params(json!({"target": "101", "text": "hi"})))
        .expect("type at the same cursor");
    assert_eq!(
        renderer.tick(),
        Some(&CursorReport {
            colour,
            badge: Action::Text,
            placement: CursorPlacement::BadgeOnly(Some(point)),
        }),
        "positionless text changes only the badge"
    );
}

#[test]
fn report_precedes_the_send_and_the_send_does_not_wait_for_the_glide() {
    let run = Run::new();
    let reports = Arc::new(OnceLock::<CursorReports>::new());
    let seen = Arc::new(Mutex::new(Vec::new()));
    let observed = Arc::clone(&seen);
    let observed_reports = Arc::clone(&reports);
    let marker = run.marker_file();
    let backend = Probe::new(
        run.fake(),
        Box::new(move |inner, input, route| {
            let before_send = observed_reports.get().and_then(CursorReports::latest);
            let written = std::fs::read_to_string(&marker).expect("marker at send");
            observed.lock().expect("observations").push((
                input.event.clone(),
                before_send,
                serde_json::from_str::<serde_json::Value>(&written).expect("marker"),
            ));
            inner.post_input(input, route)
        }),
    );
    let mut session = run.session(Box::new(backend));
    let feed = session.cursor_reports().expect("open feed");
    assert!(reports.set(feed.clone()).is_ok());
    let mut renderer = FakeRenderer::held(feed);

    session
        .click(click("first"))
        .expect("first click with held renderer");
    session
        .click(params(
            json!({ "target": "101", "x": 25, "y": 25, "callId": "latest" }),
        ))
        .expect("second click with held renderer");
    assert_eq!(run.sink.len(), 6);
    assert!(
        run.sink
            .lines()
            .iter()
            .all(|line| line.contains("route=backgroundwindow"))
    );
    assert!(
        renderer.drawn.is_none(),
        "no renderer tick was needed for either click"
    );

    let observed = seen.lock().expect("observations");
    let (groups, remainder) = observed.as_chunks::<3>();
    assert!(remainder.is_empty());
    assert_eq!(groups.len(), 2);
    for (group, name) in groups.iter().zip(["first", "latest"]) {
        let InputEvent::PointerMove(point) = group[0].0 else {
            panic!("first input aims")
        };
        let report = group[0].1.as_ref().expect("intent visible at first input");
        assert_eq!(report.placement, CursorPlacement::Aim(point));
        assert_eq!(report.badge, Action::Click);
        assert_eq!(group[0].2["binding"]["callId"], json!(name));
        for (_, other, _) in &group[1..] {
            assert!(Arc::ptr_eq(
                report,
                other.as_ref().expect("intent remains visible")
            ));
        }
    }
    let first = observed[0].1.as_ref().expect("first");
    let latest = observed[3].1.as_ref().expect("latest");
    assert_ne!(
        first.placement, latest.placement,
        "different admitted points"
    );
    assert_eq!(
        renderer.tick(),
        Some(latest.as_ref()),
        "held renderer gets only the newest intent"
    );
    assert!(Arc::ptr_eq(
        renderer.drawn.as_ref().expect("drawn latest"),
        latest
    ));
}

#[test]
fn refused_calls_do_not_publish_an_intent() {
    let run = Run::new();
    let mut session = crate::Session::for_roots(Box::new(run.fake()), &run.roots());
    session.open(params(json!({}))).expect("open");
    let mut renderer = FakeRenderer::held(session.cursor_reports().expect("open feed"));
    let refused = session
        .click(click("no-stop"))
        .expect_err("stop path required");
    assert_eq!(wire(&refused).0, "StopPathUnavailable");
    assert!(renderer.tick().is_none());

    session.stop_path_start(params(json!({})));
    session.capture_frame("101", true, None).expect("frame");
    std::fs::write(run.dir.path().join("markers"), b"not a directory").expect("block markers");
    let refused = session
        .click(click("no-marker"))
        .expect_err("marker failure");
    assert_eq!(
        wire(&refused),
        ("TransactionFailed", Some("marker_unavailable"))
    );
    assert!(renderer.tick().is_none());
    assert!(run.sink.is_empty());
}

#[test]
fn admitted_intent_does_not_claim_backend_delivery() {
    let run = Run::new();
    let backend = Probe::new(
        run.fake(),
        Box::new(|_, _, _| Err(Refusal::new(EngineCode::Internal, Reason::InputUnsupported))),
    );
    let mut session = run.session(Box::new(backend));
    let mut renderer = FakeRenderer::held(session.cursor_reports().expect("open feed"));
    let refused = session
        .click(click("backend-refused"))
        .expect_err("backend refused after admission");
    assert_eq!(wire(&refused), ("Internal", Some("input_unsupported")));
    assert!(run.sink.is_empty());
    assert_eq!(
        renderer.tick().expect("admitted intent").badge,
        Action::Click
    );
}

#[test]
fn teardown_clears_the_feed_and_reopen_gets_the_next_host_colour() {
    let run = Run::new();
    let mut session = run.session(Box::new(run.fake()));
    let scenario = SCENARIO.replace("\"101\"", "\"102\"");
    let backend = run.fake_of(&scenario, omo_computer_backend_fake::Persona::host());
    let mut other = crate::Session::for_roots(Box::new(backend), &run.roots());
    other.open(params(json!({}))).expect("second open");
    other.stop_path_start(params(json!({})));
    let prior = session.cursor_reports().expect("first feed");
    let other_feed = other.cursor_reports().expect("second feed");
    session.click(click("first")).expect("click");
    assert!(
        other_feed.latest().is_none(),
        "sessions do not share a cursor"
    );
    other
        .type_text(params(json!({"target": "102", "text": "hi"})))
        .expect("type in the other session");
    let colours = &CursorLook::shipped().session_colours;
    assert_eq!(prior.latest().expect("first intent").colour, colours[0]);
    assert_eq!(
        other_feed.latest().expect("other intent").colour,
        colours[1]
    );
    session.close();
    assert!(session.cursor_reports().is_none());
    assert!(
        prior.latest().is_none(),
        "a held reader cannot recover a closed session's report"
    );

    session.open(params(json!({}))).expect("reopen");
    session.stop_path_start(params(json!({})));
    let next = session.cursor_reports().expect("fresh feed");
    session
        .type_text(params(json!({"target": "101", "text": "hi"})))
        .expect("type");
    assert_eq!(
        next.latest().as_deref(),
        Some(&CursorReport {
            colour: &colours[2],
            badge: Action::Text,
            placement: CursorPlacement::BadgeOnly(None),
        })
    );
    assert!(
        prior.latest().is_none(),
        "reopening does not revive the old reader"
    );
    drop(session);
    assert!(
        next.latest().is_none(),
        "dropping an engine session also clears the feed"
    );
    assert_eq!(
        other_feed.latest().expect("other still open").colour,
        colours[1]
    );
}
