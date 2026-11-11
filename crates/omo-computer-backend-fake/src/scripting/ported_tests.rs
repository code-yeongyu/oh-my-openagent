//! Tests that back the `ported:` lines of the parity manifest for scripted reads, focus
//! records and unanswered AX writes: each one fails if the old test's behaviour breaks.

use crate::{fixtures_dir, FakeBackend, FakeScenario, FocusRecordKind, FocusRecordOutcome};
use omo_computer_core::backend::{AxBackend, Ref, Semantic, SnapshotRequest, Target};
use omo_computer_core::error::EngineCode;
use omo_computer_core::params::ObserveOptions;

fn window(id: &str, focused: bool) -> String {
    format!(
        r#"{{"id":"{id}","title":"w{id}","app":"a","pid":1,"x":0,"y":0,"width":10,"height":10,"focused":{focused},"elevated":null}}"#
    )
}

fn load(name: &str) -> FakeScenario {
    FakeScenario::load(&fixtures_dir().join(name)).unwrap_or_else(|e| panic!("{name}: {e}"))
}

#[test]
fn focus_reads_serve_scripted_windows_in_order_then_fall_back() {
    let json = format!(
        r#"{{"windows":[{},{},{},{}],"focus_reads":[
            {{"window":"102","focused_window":"103","focused_element_window":"104"}},
            {{"window":"102","focused_window":"104","focused_element_window":"103"}}]}}"#,
        window("101", true),
        window("102", false),
        window("103", false),
        window("104", false)
    );
    let fake = FakeBackend::from_json(&json).expect("the scenario loads");
    let first = fake.focus_read("102");
    assert_eq!(
        (
            first.focused_window.as_str(),
            first.focused_element_window.as_str()
        ),
        ("103", "104")
    );
    let second = fake.focus_read("102");
    assert_eq!(
        (
            second.focused_window.as_str(),
            second.focused_element_window.as_str()
        ),
        ("104", "103")
    );
    let fallback = fake.focus_read("102");
    assert_eq!(
        (
            fallback.focused_window.as_str(),
            fallback.focused_element_window.as_str()
        ),
        ("101", "101"),
        "once the reads run out, the focused window"
    );
    assert_eq!(
        fake.focus_read("103").focused_window,
        "101",
        "reads are per window"
    );
    assert!(fake.sink().is_empty(), "a read sends nothing");
}

#[test]
fn focus_records_follow_every_kind_of_the_effects_table() {
    let mut fake = FakeBackend::new(load("v2-scripting.json"));
    let mut record = |kind| fake.focus_record(kind, "101").expect("recorded");
    let seen = [
        record(FocusRecordKind::Short),
        record(FocusRecordKind::Short),
        record(FocusRecordKind::Full),
        record(FocusRecordKind::Full),
        record(FocusRecordKind::Full),
        record(FocusRecordKind::AxWrite),
        record(FocusRecordKind::AxWrite),
    ];
    use FocusRecordOutcome::{Failed, NoEffect, TookEffect};
    assert_eq!(
        seen,
        [NoEffect, TookEffect, NoEffect, TookEffect, TookEffect, Failed, TookEffect]
    );
    assert_eq!(
        fake.sink().lines(),
        [
            "focus_record kind=short window=101 outcome=noeffect",
            "focus_record kind=short window=101 outcome=tookeffect",
            "focus_record kind=full window=101 outcome=noeffect",
            "focus_record kind=full window=101 outcome=tookeffect",
            "focus_record kind=full window=101 outcome=tookeffect",
            "focus_record kind=axwrite window=101 outcome=failed",
            "focus_record kind=axwrite window=101 outcome=tookeffect",
        ]
    );
}

#[test]
fn ax_cannot_complete_queues_exactly_one_write_per_entry() {
    let mut fake = FakeBackend::new(load("ax-unconfirmed.json"));
    fake.snapshot(&SnapshotRequest {
        target: Target::Window("101".to_owned()),
        options: ObserveOptions::default(),
    })
    .expect("a tree");
    let (field, save) = (Ref("s1:e2".to_owned()), Ref("s1:e3".to_owned()));
    for (target, action) in [(&save, "press"), (&field, "set_value"), (&field, "focus")] {
        let semantic = Semantic(action.to_owned());
        let first = fake.perform(target, &semantic);
        assert_eq!(
            first.map_err(|r| r.code),
            Err(EngineCode::AxUnconfirmed),
            "{action}: the queued write"
        );
        let second = fake.perform(target, &semantic).map(|d| (d.count, d.of));
        assert_eq!(second, Ok((1, 1)), "{action}: the next write is answered");
    }
    let lines = fake.sink().lines();
    assert_eq!(lines.len(), 6, "every write went out: {lines:?}");
    assert_eq!(
        lines
            .iter()
            .filter(|l| l.ends_with("outcome=cannot_complete"))
            .count(),
        3
    );
}
