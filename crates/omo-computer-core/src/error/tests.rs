//! Totality of the `COMPUTER_*` table over the closed engine codes, every reason, every
//! layer failure, the imported corpus's numbered errors and the backend defaults.

use std::collections::BTreeSet;
use std::path::Path;

use serde_json::Value;

use super::{
    from_refusal, from_wire, lookup, rows, ComputerCode, DispositionRule, EngineCode, FailureKey,
    LayerFailure, NothingSent, Reason, Source, UnknownFailure,
};
use crate::backend::{
    AxBackend, Backend, CaptureOptions, InputEvent, Ref, Refusal, Route, Semantic,
    SnapshotRequest, TaggedInput, Target, WindowFilter, PRESENCE_UNAVAILABLE,
};
use crate::params::{ObserveOptions, Point};
use crate::report::{Delivery, Retry};

fn recovery_expected(retry: Retry) -> bool {
    matches!(retry, Retry::Safe | Retry::AfterUser)
}

fn check_row_rules(problems: &mut Vec<String>) {
    for row in rows() {
        let key = row.key;
        if row.retryable != row.disposition.retryable() {
            problems.push(format!("{key:?}: retryable disagrees with the disposition"));
        }
        let (nothing, some) = match row.disposition {
            DispositionRule::Fixed(pair) => (pair, None),
            DispositionRule::BySent { nothing, some } => (nothing, Some(some)),
            DispositionRule::OfInnerCode | DispositionRule::LastReport => continue,
        };
        if row.recovery.is_some() != recovery_expected(nothing.retry()) {
            problems.push(format!("{key:?}: recovery present only when retry is safe or after_user"));
        }
        let refused = nothing.delivery() == Delivery::NotDelivered;
        let consistent = match (row.nothing_sent, some) {
            (NothingSent::Yes, None) => refused,
            (NothingSent::No, None) => !refused,
            (NothingSent::Depends, Some(some)) => refused && some.delivery() != Delivery::NotDelivered,
            (NothingSent::Depends, None) => true,
            _ => false,
        };
        if !consistent {
            problems.push(format!("{key:?}: nothingSent disagrees with the disposition"));
        }
    }
}

#[test]
fn error_table_is_total_over_codes_and_reasons() {
    let mut problems = Vec::new();
    let numbers: Vec<i64> = EngineCode::ALL.iter().map(|code| code.number()).collect();
    assert_eq!(numbers, (0..33).map(|ordinal| -32_000 - ordinal).collect::<Vec<i64>>());
    let keys: Vec<FailureKey> = rows().map(|row| row.key).collect();
    let unique: BTreeSet<FailureKey> = keys.iter().copied().collect();
    if unique.len() != keys.len() {
        problems.push(format!("{} rows share a key", keys.len() - unique.len()));
    }
    for code in EngineCode::ALL {
        if lookup(FailureKey { source: Source::Engine(code), reason: None }).is_err() {
            problems.push(format!("engine code {} has no row", code.wire()));
        }
    }
    for layer in LayerFailure::ALL {
        if lookup(FailureKey { source: Source::Layer(layer), reason: None }).is_err() {
            problems.push(format!("layer failure {} has no row", layer.wire()));
        }
    }
    let reached: BTreeSet<ComputerCode> = rows().map(|row| row.computer).collect();
    for computer in ComputerCode::ALL.into_iter().filter(|computer| !reached.contains(computer)) {
        problems.push(format!("{} is reached by no row", computer.wire()));
    }
    let used: BTreeSet<Reason> = rows().filter_map(|row| row.key.reason).collect();
    for reason in Reason::ALL.into_iter().filter(|reason| !used.contains(reason)) {
        problems.push(format!("reason {} is emitted under no code", reason.wire()));
    }
    check_row_rules(&mut problems);
    for row in rows() {
        if let Source::Engine(code) = row.key.source {
            let back = from_wire(code.number(), row.key.reason.map(Reason::wire));
            if back.ok() != Some(row) {
                problems.push(format!("{:?} does not round-trip through the wire", row.key));
            }
        }
    }
    assert!(ComputerCode::ALL.iter().all(|computer| computer.wire() != "COMPUTER_ERROR"));
    assert_eq!(from_wire(-31_999, None).err(), Some(UnknownFailure::Code(-31_999)));
    assert!(matches!(
        from_wire(EngineCode::InputBusy.number(), Some("not_a_reason")),
        Err(UnknownFailure::Reason { .. })
    ));
    let unlisted = FailureKey { source: Source::Engine(EngineCode::Suspended), reason: Some(Reason::Budget) };
    assert_eq!(lookup(unlisted).err(), Some(UnknownFailure::Pair(unlisted)));
    println!(
        "{} rows: {} engine codes, {} layer failures, {} reasons, {} COMPUTER_* members reached",
        keys.len(),
        EngineCode::ALL.len(),
        LayerFailure::ALL.len(),
        used.len(),
        reached.len()
    );
    assert_eq!(ComputerCode::ALL.len(), 56);
    assert!(problems.is_empty(), "{} problems:\n{}", problems.len(), problems.join("\n"));
}

fn corpus_errors(path: &Path, found: &mut Vec<(i64, String)>) {
    let Ok(text) = std::fs::read_to_string(path) else { return };
    let Ok(case) = serde_json::from_str::<Value>(&text) else { return };
    for step in case["steps"].as_array().into_iter().flatten() {
        for expect in step["expect"].as_array().into_iter().flatten() {
            let error = &expect["message"]["error"];
            if let (Some(number), Some(name)) = (error["code"].as_i64(), error["data"]["code"].as_str()) {
                found.push((number, name.to_owned()));
            }
        }
    }
}

#[test]
fn imported_engine_errors_name_the_closed_codes() {
    let directory = Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/conformance");
    let mut found = Vec::new();
    for entry in std::fs::read_dir(directory).expect("corpus directory").flatten() {
        corpus_errors(&entry.path(), &mut found);
    }
    let mut seen = BTreeSet::new();
    for (number, name) in &found {
        let code = EngineCode::from_number(*number);
        assert_eq!(code.map(EngineCode::wire), Some(name.as_str()), "{number} is not {name}");
        assert!(from_wire(*number, None).is_ok(), "{name} has no bare row");
        seen.insert(*number);
    }
    println!("{} imported engine errors, {} distinct codes", found.len(), seen.len());
    assert_eq!(seen.len(), 31, "the imported corpus pins the 31 numbered codes");
}

struct Bare;
impl Backend for Bare {}
impl AxBackend for Bare {}

#[test]
fn backend_refusals_map_through_the_table() {
    let mut bare = Bare;
    let input = TaggedInput { event: InputEvent::PointerMove(Point { x: 1.0, y: 2.0 }), tag: 7 };
    let capture = CaptureOptions { cursor: true, crosshair: None, region: None };
    let reference = Ref("s1:e2".to_owned());
    let request = SnapshotRequest { target: Target::Desktop, options: ObserveOptions::default() };
    let refusals: Vec<Refusal> = [
        bare.windows(&WindowFilter::default()).err(),
        bare.displays().err(),
        bare.capture(&Target::Window("101".to_owned()), &capture).err(),
        bare.post_input(&input, Route::BackgroundPid).err(),
        bare.stop_listener().err(),
        bare.epoch_source().next_change().err(),
        bare.snapshot(&request).err(),
        bare.resolve(&reference).err(),
        bare.perform(&reference, &Semantic("press".to_owned())).err(),
        bare.events().next_event().err(),
        Some(PRESENCE_UNAVAILABLE),
    ]
    .into_iter()
    .flatten()
    .collect();
    assert_eq!(refusals.len(), 11, "every default refuses");
    for refusal in &refusals {
        let row = from_refusal(refusal).unwrap_or_else(|error| panic!("{refusal:?}: {error}"));
        println!("{:?}{{{}}} -> {:?} -> {}", refusal.code, refusal.reason, row.key, row.computer.wire());
        assert_eq!(row.computer.wire(), refusal.code.computer_code(), "{refusal:?}");
        assert_eq!(row.nothing_sent, NothingSent::Yes, "{refusal:?}: a refusal sends nothing");
    }
}
