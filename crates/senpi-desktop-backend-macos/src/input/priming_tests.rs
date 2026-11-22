//! Every branch of key priming over a test double scripted with the fake
//! backend's scenario shapes (`focus_reads`, `focus_record_effects`), so the
//! two stay in sync.

use std::collections::{HashMap, VecDeque};
use std::time::Duration;

use senpi_desktop_core::error::{CoreResult, DesktopError, ErrorCode};
use senpi_desktop_core::report::{Disposition, FocusRestoration};
use serde_json::{json, Value};

use super::*;
use crate::skylight::reporting_partial;

const TARGET: u32 = 102;
const OTHER: u32 = 101;

#[derive(Debug, Clone, PartialEq, Eq)]
enum Op {
    Read,
    Record(Move),
    MakeKey(u32),
    Key,
}

/// The target app as the fake scenario scripts it: queued focus reads for
/// the target window, then the app's live focus; per-kind record outcomes,
/// unscripted ones taking effect.
struct Double {
    reads: VecDeque<Read>,
    effects: HashMap<Move, VecDeque<String>>,
    focused: Option<u32>,
    element: Option<u32>,
    /// Takeover answers in order; unscripted ones are false.
    active: VecDeque<bool>,
    /// Frontmost answers in order; unscripted ones are false.
    front: VecDeque<bool>,
    order: Vec<u32>,
    refuse_make_key: bool,
    /// After a make-key write, the read still shows the target.
    make_key_unseen: bool,
    ops: Vec<Op>,
    waited: Duration,
}

fn window(value: &Value) -> Option<u32> {
    value.as_str().and_then(|id| id.parse().ok())
}

impl Double {
    fn scenario(scenario: &Value) -> Self {
        let reads = scenario["focus_reads"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|read| window(&read["window"]) == Some(TARGET))
            .map(|read| match read["gone"].as_bool() {
                Some(true) => Read::Gone,
                _ if read["unreadable"].as_bool() == Some(true) => Read::Unreadable,
                _ => Read::Focus(FocusRead {
                    focused_window: window(&read["focused_window"]),
                    element_window: window(&read["focused_element_window"]),
                }),
            })
            .collect();
        let kind = |name: &str| match name {
            "short" => Move::Short,
            "full" => Move::Full,
            "ax_write" => Move::AxWrite,
            other => panic!("unknown record kind {other}"),
        };
        let effects = scenario["focus_record_effects"]
            .as_object()
            .into_iter()
            .flatten()
            .map(|(name, outcomes)| {
                let outcomes = outcomes.as_array().unwrap().iter().map(|o| o.as_str().unwrap().to_owned()).collect();
                (kind(name), outcomes)
            })
            .collect();
        Self {
            reads,
            effects,
            focused: Some(OTHER),
            element: Some(OTHER),
            active: VecDeque::new(),
            front: VecDeque::new(),
            order: vec![OTHER, TARGET],
            refuse_make_key: false,
            make_key_unseen: false,
            ops: Vec::new(),
            waited: Duration::ZERO,
        }
    }

    fn records(&self) -> Vec<Move> {
        self.ops.iter().filter_map(|op| if let Op::Record(step) = op { Some(*step) } else { None }).collect()
    }

    fn keys(&self) -> usize {
        self.ops.iter().filter(|op| **op == Op::Key).count()
    }
}

impl PrimingOps for Double {
    fn read(&mut self) -> Read {
        self.ops.push(Op::Read);
        self.reads.pop_front().unwrap_or(Read::Focus(FocusRead {
            focused_window: self.focused,
            element_window: self.element,
        }))
    }

    fn apply(&mut self, step: Move) -> bool {
        self.ops.push(Op::Record(step));
        let outcome = self.effects.get_mut(&step).and_then(VecDeque::pop_front);
        match outcome.as_deref().unwrap_or("took_effect") {
            "took_effect" => {
                (self.focused, self.element) = (Some(TARGET), Some(TARGET));
                true
            }
            "no_effect" => true,
            "failed" => false,
            other => panic!("unknown outcome {other}"),
        }
    }

    fn wait(&mut self, time: Duration) {
        self.waited += time;
    }

    fn user_active_in_target(&mut self) -> bool {
        self.active.pop_front().unwrap_or(false)
    }

    fn target_app_front(&mut self) -> bool {
        self.front.pop_front().unwrap_or(false)
    }

    fn window_order(&mut self) -> Vec<u32> {
        self.order.clone()
    }

    fn make_key(&mut self, window: u32) -> bool {
        self.ops.push(Op::MakeKey(window));
        if self.refuse_make_key {
            return false;
        }
        if !self.make_key_unseen {
            (self.focused, self.element) = (Some(window), Some(window));
        }
        true
    }
}

/// Types `n` keys, the stop check refusing before key `stop_at`.
fn send(n: usize, stop_at: Option<usize>) -> impl FnOnce(&mut Double) -> CoreResult<usize> {
    move |ops| {
        for index in 0..n {
            if Some(index) == stop_at {
                return Err(DesktopError::new(ErrorCode::Cancelled, "stopped"));
            }
            ops.ops.push(Op::Key);
        }
        Ok(n)
    }
}

fn report(error: &DesktopError) -> (Option<&str>, Option<Disposition>) {
    let report = error.report.as_deref().expect("a report");
    (report.reason.as_deref(), report.disposition)
}

struct Case {
    name: &'static str,
    scenario: Value,
    records: &'static [Move],
}

#[test]
fn every_priming_route_sends_only_on_proof_and_hands_key_back() {
    let cases = [
        Case {
            name: "already key",
            scenario: json!({"focus_reads": [{"window": "102", "focused_window": "102", "focused_element_window": "102"}]}),
            records: &[],
        },
        Case {
            name: "short ok",
            scenario: json!({"focus_record_effects": {"short": ["took_effect"]}}),
            records: &[Move::Short],
        },
        Case {
            name: "full 1st ok",
            scenario: json!({"focus_record_effects": {"short": ["no_effect"], "full": ["took_effect"]}}),
            records: &[Move::Short, Move::Full],
        },
        Case {
            name: "full 2nd ok",
            scenario: json!({"focus_record_effects": {"short": ["failed"], "full": ["no_effect", "took_effect"]}}),
            records: &[Move::Short, Move::Full, Move::Full],
        },
        Case {
            name: "ax write ok",
            scenario: json!({"focus_record_effects": {"short": ["no_effect"], "full": ["no_effect", "no_effect"], "ax_write": ["took_effect"]}}),
            records: &[Move::Short, Move::Full, Move::Full, Move::AxWrite],
        },
        Case {
            name: "element focus in another window is no proof",
            scenario: json!({
                "focus_reads": [{"window": "102", "focused_window": "102", "focused_element_window": "101"}],
                "focus_record_effects": {"short": ["took_effect"]}
            }),
            records: &[Move::Short],
        },
    ];
    for case in cases {
        let mut double = Double::scenario(&case.scenario);
        let (result, restored) = primed_delivery(TARGET, &mut double, send(4, None));
        assert_eq!(result.as_ref().ok(), Some(&4), "{}: {result:?}", case.name);
        assert_eq!(double.keys(), 4, "{}", case.name);
        assert_eq!(double.records(), case.records, "{}", case.name);
        let moved = !case.records.is_empty();
        assert_eq!(restored, moved.then_some(FocusRestoration::Restored), "{}", case.name);
        if moved {
            assert_eq!(double.ops.last(), Some(&Op::Read), "{}: hand-back confirmed by a read", case.name);
            assert!(double.ops.contains(&Op::MakeKey(OTHER)), "{}: previous key restored", case.name);
            // Keys are posted after the proof and before the hand-back.
            let first_key = double.ops.iter().position(|op| *op == Op::Key).unwrap();
            let last_record = double.ops.iter().rposition(|op| matches!(op, Op::Record(_))).unwrap();
            let hand_back = double.ops.iter().position(|op| matches!(op, Op::MakeKey(_))).unwrap();
            assert!(last_record < first_key && first_key < hand_back, "{}: {:?}", case.name, double.ops);
        }
    }
}

#[test]
fn priming_reports_how_the_window_became_key() {
    let mut double = Double::scenario(&json!({"focus_record_effects": {"short": ["no_effect"], "full": ["took_effect"]}}));
    assert_eq!(prime(TARGET, &mut double).outcome.ok(), Some(Primed::Moved(Move::Full)));
    let mut double = Double::scenario(&json!({"focus_reads": [{"window": "102", "focused_window": "102", "focused_element_window": "102"}]}));
    let priming = prime(TARGET, &mut double);
    assert_eq!(priming.outcome.ok(), Some(Primed::AlreadyKey));
    assert!(priming.hand_back.is_none(), "key never moved, nothing to hand back");
}

#[test]
fn an_unproven_route_refuses_with_nothing_sent_and_stays_rerunnable() {
    let scenario = json!({"focus_record_effects": {
        "short": ["no_effect"], "full": ["no_effect", "no_effect"], "ax_write": ["no_effect"]
    }});
    let mut double = Double::scenario(&scenario);
    // Neither records nor accessibility writes mark the call sent, so the
    // refusal survives `reporting_partial` as a rerunnable refusal.
    let mut restored = None;
    let error = reporting_partial(|| {
        let (result, layer1) = primed_delivery(TARGET, &mut double, send(5, None));
        restored = layer1;
        result
    })
    .unwrap_err();
    assert_eq!(error.code, ErrorCode::BackgroundUnavailable, "{error:?}");
    assert_eq!(report(&error), (Some("key_route_unproven"), Some(Disposition::NOT_DELIVERED_SAFE)));
    assert!(error.message.contains("focusedWindow 101, elementWindow 101"), "{}", error.message);
    assert!(error.message.contains("nothing was sent"), "{}", error.message);
    assert_eq!(double.keys(), 0);
    assert_eq!(double.records(), [Move::Short, Move::Full, Move::Full, Move::AxWrite]);
    assert!(double.ops.contains(&Op::MakeKey(OTHER)), "hand-back still runs after a refusal");
    assert_eq!(restored, Some(FocusRestoration::Restored));
    // The full form settles once per attempt, the others poll for 40 ms, and
    // the hand-back's first poll already sees the previous window.
    assert_eq!(double.waited, Duration::from_millis(40 + 120 + 120 + 40 + 10));
}

#[test]
fn an_unreadable_or_closed_target_sends_nothing() {
    let mut double = Double::scenario(&json!({"focus_reads": [{"window": "102", "unreadable": true}]}));
    let (result, restored) = primed_delivery(TARGET, &mut double, send(3, None));
    let error = result.unwrap_err();
    assert_eq!(report(&error).0, Some("key_route_unproven"));
    assert!(error.message.contains("focusedWindow unreadable"), "{}", error.message);
    assert_eq!((double.keys(), double.records().len(), restored), (0, 0, None));

    let mut double = Double::scenario(&json!({"focus_reads": [{"window": "102", "gone": true}]}));
    let (result, _) = primed_delivery(TARGET, &mut double, send(3, None));
    assert_eq!(result.unwrap_err().code, ErrorCode::WindowNotFound);
    assert_eq!(double.keys(), 0);

    let mut double = Double::scenario(&json!({
        "focus_reads": [{"window": "102", "focused_window": "101"}, {"window": "102", "gone": true}]
    }));
    let (result, restored) = primed_delivery(TARGET, &mut double, send(3, None));
    assert_eq!(result.unwrap_err().code, ErrorCode::WindowNotFound);
    assert_eq!((double.keys(), restored.is_some()), (0, true));
}

#[test]
fn the_takeover_recheck_after_priming_refuses_and_still_hands_back() {
    let mut double = Double::scenario(&json!({"focus_record_effects": {"short": ["took_effect"]}}));
    double.active = VecDeque::from([true]);
    let (result, restored) = primed_delivery(TARGET, &mut double, send(3, None));
    let error = result.unwrap_err();
    assert_eq!(error.code, ErrorCode::BackgroundUnavailable);
    assert_eq!(report(&error), (Some("user_active_in_target"), Some(Disposition::NOT_DELIVERED_AFTER_USER)));
    assert_eq!(double.keys(), 0);
    assert_eq!(restored, Some(FocusRestoration::Restored));
}

#[test]
fn an_interrupted_send_keeps_its_count_and_hands_back() {
    let mut double = Double::scenario(&json!({"focus_record_effects": {"short": ["took_effect"]}}));
    let (result, restored) = primed_delivery(TARGET, &mut double, send(5, Some(3)));
    assert_eq!(result.unwrap_err().code, ErrorCode::Cancelled);
    assert_eq!(double.keys(), 3, "delivered {{3, 5}}");
    assert_eq!(restored, Some(FocusRestoration::Restored));
}

#[test]
fn hand_back_outcomes() {
    let plan = |previous_key, order: Vec<u32>, front_at_start| HandBack { target: TARGET, previous_key, order, front_at_start };
    let fresh = || Double::scenario(&json!({}));

    let mut double = fresh();
    assert_eq!(hand_back(&plan(Some(OTHER), vec![OTHER, TARGET], false), &mut double), FocusRestoration::Restored);

    // The user brought the app to the front during the action: their window wins.
    let mut double = fresh();
    double.front = VecDeque::from([true]);
    assert_eq!(hand_back(&plan(Some(OTHER), vec![OTHER], false), &mut double), FocusRestoration::UserMovedOn);
    assert!(!double.ops.iter().any(|op| matches!(op, Op::MakeKey(_))));
    // An app that was already front is still handed back.
    let mut double = fresh();
    double.front = VecDeque::from([true]);
    assert_eq!(hand_back(&plan(Some(OTHER), vec![OTHER], true), &mut double), FocusRestoration::Restored);

    let mut double = fresh();
    double.refuse_make_key = true;
    assert_eq!(hand_back(&plan(Some(OTHER), vec![OTHER, 103], false), &mut double), FocusRestoration::NotConfirmed);
    assert_eq!(double.ops, [Op::MakeKey(OTHER), Op::MakeKey(OTHER), Op::MakeKey(103)]);

    let mut double = fresh();
    (double.focused, double.element) = (Some(TARGET), Some(TARGET));
    double.make_key_unseen = true;
    assert_eq!(hand_back(&plan(Some(OTHER), vec![], false), &mut double), FocusRestoration::NotConfirmed);

    // No key window before priming: the app's next window front to back.
    let mut double = fresh();
    assert_eq!(hand_back(&plan(None, vec![TARGET, 103], false), &mut double), FocusRestoration::Restored);
    assert_eq!(double.ops.first(), Some(&Op::MakeKey(103)));

    let mut double = fresh();
    assert_eq!(hand_back(&plan(None, vec![TARGET], false), &mut double), FocusRestoration::NotNeeded);
    assert!(double.ops.is_empty());
}
