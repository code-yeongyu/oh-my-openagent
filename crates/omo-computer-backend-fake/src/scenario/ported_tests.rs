//! Tests that back the `ported:` lines of the parity manifest for the scenario format: the
//! v2 fixture's parsed values, and the defaults every imported v1 fixture leaves.

use serde_json::Value;

use crate::{
    fixtures_dir, EpochReason, FakeMethod, FakeScenario, FocusRecordKind, FocusRecordOutcome,
    UserInputKind,
};

fn load(name: &str) -> FakeScenario {
    FakeScenario::load(&fixtures_dir().join(name)).unwrap_or_else(|e| panic!("{name}: {e}"))
}

#[test]
fn v2_fixture_values_parse_into_every_field() {
    let scenario = load("v2-scripting.json");
    let ids = |list: &[crate::FakeWindow]| list.iter().map(|w| w.id.clone()).collect::<Vec<_>>();
    assert_eq!(ids(&scenario.windows), ["101", "102"]);
    assert_eq!(
        scenario.identity.get("101").map(|i| i.process_start),
        Some(1_700_000_000)
    );
    assert_eq!(
        scenario.identity.get("102").map(|i| i.process_start),
        Some(1_700_000_000)
    );
    assert_eq!(
        scenario.identity.len(),
        2,
        "identity carries exactly 101 and 102"
    );
    let change = &scenario.identity_changes[0];
    assert_eq!(
        (
            change.after_call,
            change.nth,
            change.window.as_str(),
            change.new_pid,
            change.new_process_start
        ),
        (FakeMethod::Capture, 1, "101", 5151, 1_700_000_999)
    );
    let read = &scenario.focus_reads[0];
    assert_eq!(
        (
            read.window.as_str(),
            read.focused_window.as_str(),
            read.focused_element_window.as_str()
        ),
        ("102", "101", "101")
    );
    assert_eq!(
        scenario.focus_record_effects.get(&FocusRecordKind::Short),
        Some(&vec![FocusRecordOutcome::NoEffect])
    );
    assert_eq!(
        scenario.focus_record_effects.get(&FocusRecordKind::Full),
        Some(&vec![
            FocusRecordOutcome::NoEffect,
            FocusRecordOutcome::TookEffect
        ])
    );
    assert_eq!(
        scenario.focus_record_effects.get(&FocusRecordKind::AxWrite),
        Some(&vec![FocusRecordOutcome::Failed])
    );
    let hit = &scenario.hit_at[0];
    assert_eq!(
        (
            hit.x,
            hit.y,
            hit.role.as_str(),
            hit.label.as_deref(),
            hit.secure
        ),
        (120.0, 140.0, "textfield", Some("Password"), true)
    );
    let input = &scenario.user_input_timeline[0];
    assert_eq!(
        (input.t_ms, input.pid, input.kind),
        (-500, 4242, UserInputKind::Key)
    );
    assert_eq!(
        (
            scenario.frontmost_pid,
            scenario.ax_deadline_ms,
            scenario.ax_node_count.get("101").copied()
        ),
        (Some(4242), Some(50), Some(10_000))
    );
    let epoch = &scenario.epoch_events[0];
    assert_eq!(
        (epoch.after_call, epoch.nth, epoch.reason),
        (FakeMethod::Windows, 2, EpochReason::Lock)
    );
    let displays = scenario.displays_change.as_ref().expect("displays_change");
    assert_eq!(
        (displays.after_call, displays.nth, displays.displays.len()),
        (FakeMethod::Click, 1, 0)
    );
    assert_eq!(
        scenario.stop_marker.as_deref(),
        Some("/var/run/omo-computer/stop")
    );
}

/// The fields the v2 scripting row added; a v1 fixture leaves each at its default.
const V2_FIELDS: [&str; 12] = [
    "identity",
    "identity_changes",
    "focus_reads",
    "focus_record_effects",
    "hit_at",
    "user_input_timeline",
    "frontmost_pid",
    "ax_deadline_ms",
    "ax_node_count",
    "epoch_events",
    "displays_change",
    "stop_marker",
];

#[test]
fn imported_v1_fixtures_leave_every_v2_field_at_its_default() {
    let defaults = FakeScenario::default();
    let mut checked = 0;
    for entry in std::fs::read_dir(fixtures_dir()).expect("fixtures") {
        let path = entry.expect("entry").path();
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        if name.starts_with("v2-") || name.starts_with("v3-") || !name.ends_with(".json") {
            continue;
        }
        let raw: Value =
            serde_json::from_str(&std::fs::read_to_string(&path).expect("read")).expect("json");
        assert!(
            V2_FIELDS.iter().all(|field| raw.get(field).is_none()),
            "{name} sets a v2 field"
        );
        let s = load(&name);
        assert_eq!(
            (
                &s.identity,
                &s.identity_changes,
                &s.focus_reads,
                &s.focus_record_effects,
                &s.hit_at
            ),
            (
                &defaults.identity,
                &defaults.identity_changes,
                &defaults.focus_reads,
                &defaults.focus_record_effects,
                &defaults.hit_at
            ),
            "{name}"
        );
        assert_eq!(
            (
                &s.user_input_timeline,
                s.frontmost_pid,
                s.ax_deadline_ms,
                &s.ax_node_count
            ),
            (
                &defaults.user_input_timeline,
                defaults.frontmost_pid,
                defaults.ax_deadline_ms,
                &defaults.ax_node_count
            ),
            "{name}"
        );
        assert_eq!(
            (&s.epoch_events, &s.displays_change, &s.stop_marker),
            (
                &defaults.epoch_events,
                &defaults.displays_change,
                &defaults.stop_marker
            ),
            "{name}"
        );
        checked += 1;
    }
    assert_eq!(checked, 11, "every imported v1 fixture");
}
