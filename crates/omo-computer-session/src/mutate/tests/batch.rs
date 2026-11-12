use std::sync::atomic::Ordering;
use std::sync::Arc;

use omo_computer_core::backend::Backend;
use serde_json::json;

use super::{click, params, Probe, Run};
use crate::audit::gc::SweepTrigger;
use crate::batch::{self, BatchStep, StepOutcome};
use crate::POINT_REQUIRED;

const SKIP: &str = "Skipped: an earlier action in this batch failed.";

#[test]
fn batch_halts_with_skip_text_and_one_frame() {
    let run = Run::new();
    let backend = Probe::new(
        run.fake(),
        Box::new(|inner, input, route| inner.post_input(input, route)),
    );
    let captures = Arc::clone(&backend.captures);
    let mut session = run.session(Box::new(backend));
    let opened_with = captures.load(Ordering::SeqCst);
    let steps = vec![
        BatchStep::Click(Box::new(click("b-1"))),
        BatchStep::Click(Box::new(params(
            json!({ "target": "101", "callId": "b-2" }),
        ))),
        BatchStep::TypeText(params(json!({ "target": "101", "text": "never typed" }))),
        BatchStep::Click(Box::new(click("b-4"))),
    ];
    let outcome = batch::run(&mut session, steps, SKIP);
    assert_eq!(outcome.steps.len(), 4);
    assert!(
        matches!(outcome.steps[0], StepOutcome::Done(_)),
        "{:?}",
        outcome.steps[0]
    );
    assert!(
        matches!(&outcome.steps[1], StepOutcome::Failed(refused) if refused.refusal == POINT_REQUIRED),
        "{:?}",
        outcome.steps[1]
    );
    for step in &outcome.steps[2..] {
        assert_eq!(
            step,
            &StepOutcome::Skipped {
                text: SKIP.to_owned()
            },
            "verbatim skip text"
        );
    }
    assert!(outcome.final_frame.is_ok(), "{:?}", outcome.final_frame);
    assert_eq!(
        captures.load(Ordering::SeqCst) - opened_with,
        1,
        "exactly one appended final frame"
    );
    assert_eq!(
        run.sink.len(),
        3,
        "only step 1 sent input: {:?}",
        run.sink.lines()
    );
}

#[test]
fn session_open_and_idle_exit_sweep_the_artifact_dir() {
    let run = Run::new();
    let mut session = run.session(Box::new(run.fake()));
    session.close();
    let triggers: Vec<SweepTrigger> = session
        .artifacts()
        .expect("an engine session keeps artifacts")
        .sweeps()
        .iter()
        .map(|sweep| sweep.trigger)
        .collect();
    assert_eq!(triggers, vec![SweepTrigger::Open, SweepTrigger::IdleExit]);
}
