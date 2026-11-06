use std::path::{Path, PathBuf};

use senpi_desktop_core::backend::{Backend, DeliveryMode, Modifiers, MouseButton, PointerEvent};
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::types::{CaptureCaps, DesktopPoint, Target};
use senpi_desktop_core::user_input::{UserInputFeed, UserPressKind};

use crate::scripting::{
    EpochReason, FakeFocusRead, FakeIdentityRead, FocusRecordKind, FocusRecordOutcome,
};
use crate::{FakeBackend, FakeMethod, FakeScenario, ScenarioError, SinkOp};

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures")
}

fn v2() -> FakeBackend {
    FakeBackend::new(
        FakeScenario::load(&fixtures().join("v2-scripting.json")).expect("v2 fixture parses"),
    )
}

fn backend(json: &str) -> FakeBackend {
    FakeBackend::new(FakeScenario::from_json(json).expect("scenario parses"))
}

const TWO_WINDOWS: &str = r#""windows":[
    {"id":"101","title":"A","app":"Notes","pid":4242,"x":0,"y":0,"width":10,"height":10,"focused":true,"elevated":null},
    {"id":"102","title":"B","app":"Notes","pid":4242,"x":0,"y":0,"width":10,"height":10,"focused":false,"elevated":null}]"#;

fn capture(backend: &mut FakeBackend, window: &str) {
    backend
        .capture(
            &Target::Window(window.to_owned()),
            &CaptureCaps::default(),
            &[],
        )
        .expect("capture");
}

fn ops_matching(backend: &FakeBackend, keep: impl Fn(&SinkOp) -> bool) -> Vec<SinkOp> {
    backend
        .sink()
        .ops()
        .into_iter()
        .filter(|op| keep(op))
        .collect()
}

#[test]
fn every_existing_fixture_parses_with_todays_defaults() {
    // Given: every fixture shipped before the v2 fields
    let mut checked = 0;
    for entry in std::fs::read_dir(fixtures()).expect("fixtures dir") {
        let path = entry.expect("entry").path();
        if path
            .file_name()
            .is_some_and(|name| name == "v2-scripting.json")
        {
            continue;
        }
        // When
        let scenario =
            FakeScenario::load(&path).unwrap_or_else(|err| panic!("{}: {err}", path.display()));
        // Then
        let defaults = FakeScenario::default();
        assert_eq!(scenario.identity, defaults.identity, "{}", path.display());
        assert!(scenario.identity_changes.is_empty() && scenario.focus_reads.is_empty());
        assert!(scenario.focus_record_effects.is_empty() && scenario.hit_at.is_empty());
        assert!(scenario.user_input_timeline.is_empty() && scenario.frontmost_pid.is_none());
        assert!(scenario.ax_deadline_ms.is_none() && scenario.ax_node_count.is_empty());
        assert!(scenario.epoch_events.is_empty() && scenario.displays_change.is_none());
        assert!(scenario.stop_marker.is_none());
        checked += 1;
    }
    assert!(checked >= 10, "only {checked} fixtures found");
}

#[test]
fn empty_scenario_hooks_answer_todays_behavior() {
    let mut fake = backend(&format!("{{{TWO_WINDOWS}}}"));
    assert_eq!(fake.window_identity("101").expect("identity"), None);
    assert_eq!(fake.frontmost_pid().expect("frontmost"), Some(4242));
    assert_eq!(
        fake.hit_read(DesktopPoint { x: 1.0, y: 1.0 }).expect("hit"),
        None
    );
    assert_eq!(
        fake.record_focus(FocusRecordKind::Short, "102")
            .expect("record"),
        FocusRecordOutcome::TookEffect
    );
    assert_eq!(
        (fake.epoch(), fake.ax_deadline_ms(), fake.stop_marker()),
        (0, None, None)
    );
    capture(&mut fake, "101");
    fake.windows().expect("windows");
    assert!(ops_matching(&fake, |op| matches!(
        op,
        SinkOp::IdentityChanged { .. } | SinkOp::EpochBumped { .. }
    ))
    .is_empty());
}

#[test]
fn v2_fixture_parses_every_field() {
    let scenario = FakeScenario::load(&fixtures().join("v2-scripting.json")).expect("parses");
    assert_eq!(scenario.identity["101"].process_start, 1_700_000_000);
    assert_eq!(scenario.identity_changes[0].after_call, FakeMethod::Capture);
    assert_eq!(scenario.identity_changes[0].nth, 1);
    assert_eq!(
        scenario.identity_changes[0].new_process_start,
        1_700_000_999
    );
    assert_eq!(scenario.focus_reads.len(), 1);
    assert_eq!(
        scenario.focus_record_effects[&FocusRecordKind::Full].len(),
        2
    );
    assert!(scenario.hit_at[0].secure);
    assert_eq!(scenario.user_input_timeline[0].t_ms, -500);
    assert_eq!(scenario.frontmost_pid, Some(4242));
    assert_eq!(scenario.ax_deadline_ms, Some(50));
    assert_eq!(scenario.ax_node_count["101"], 10_000);
    assert_eq!(scenario.epoch_events[0].reason, EpochReason::Lock);
    assert_eq!(
        scenario
            .displays_change
            .as_ref()
            .map(|change| change.after_call),
        Some(FakeMethod::Click)
    );
    assert_eq!(
        scenario.stop_marker.as_deref(),
        Some("/var/run/senpi-desktop/stop")
    );
}

#[test]
fn identity_change_takes_effect_after_the_named_call() {
    // Given: window 101 changes owner after the first capture
    let mut fake = v2();
    let feed = fake.user_input();
    assert_eq!(feed.process_started(4242), Some(1_700_000_000));
    assert_eq!(fake.windows().expect("windows")[0].pid, Some(4242));
    // When
    capture(&mut fake, "101");
    let windows = fake.windows().expect("windows");
    // Then
    assert_eq!(windows[0].pid, Some(5151));
    assert_eq!(windows[1].pid, Some(4242));
    assert_eq!(feed.process_started(5151), Some(1_700_000_999));
    assert_eq!(
        ops_matching(&fake, |op| matches!(op, SinkOp::IdentityChanged { .. })),
        vec![SinkOp::IdentityChanged {
            window: "101".to_owned(),
            old_pid: Some(4242),
            new_pid: 5151,
            process_start: 1_700_000_999,
        }]
    );
    let front = fake
        .front_window()
        .expect("front")
        .expect("a focused window");
    assert_eq!((front.pid, front.window_id.as_deref()), (5151, Some("101")));
}

#[test]
fn identity_change_waits_for_the_nth_call() {
    let mut fake = backend(&format!(
        r#"{{{TWO_WINDOWS},"identity_changes":[{{"after_call":"windows","nth":2,"window":"102","new_pid":7,"new_processStart":9}}]}}"#
    ));
    fake.windows().expect("first");
    assert_eq!(fake.windows().expect("second")[1].pid, Some(4242));
    assert_eq!(fake.windows().expect("third")[1].pid, Some(7));
}

#[test]
fn identity_read_reports_pid_and_start_and_records_the_read() {
    let mut fake = v2();
    let read = fake.window_identity("102").expect("identity");
    assert_eq!(
        read,
        Some(FakeIdentityRead {
            pid: 4242,
            process_start: 1_700_000_000
        })
    );
    assert_eq!(
        fake.sink().ops(),
        vec![SinkOp::IdentityRead {
            window: "102".to_owned(),
            identity: read
        }]
    );
    assert!(fake.window_identity("999").is_err());
}

#[test]
fn identity_for_an_unknown_window_is_rejected() {
    let err = FakeScenario::from_json(r#"{"identity":{"9":{"processStart":1}}}"#)
        .expect_err("unknown window");
    assert!(err.to_string().contains("unknown window '9'"), "{err}");
    let err = FakeScenario::from_json(
        r#"{"identity_changes":[{"after_call":"capture","window":"9","new_pid":1,"new_processStart":2}]}"#,
    )
    .expect_err("unknown window");
    assert!(err.to_string().contains("unknown window '9'"), "{err}");
}

#[test]
fn unknown_fields_still_fail_to_parse() {
    for json in [
        r#"{"identity_change":[]}"#,
        r#"{"identity":{"101":{"processStart":1,"pid":2}}}"#,
        r#"{"identity_changes":[{"after_call":"capture","window":"101","new_pid":1,"new_processStart":2,"bogus":1}]}"#,
        r#"{"focus_reads":[{"window":"101","focused":"101"}]}"#,
        r#"{"focus_record_effects":{"medium":["no_effect"]}}"#,
        r#"{"hit_at":[{"x":1,"y":1,"role":"button","title":"x"}]}"#,
        r#"{"user_input_timeline":[{"t_ms":0,"pid":1,"kind":"key","when":0}]}"#,
        r#"{"epoch_events":[{"after_call":"capture","reason":"reboot"}]}"#,
        r#"{"displays_change":{"after_call":"capture","displays":[],"extra":true}}"#,
    ] {
        let err = FakeScenario::from_json(json).expect_err(json);
        assert!(matches!(err, ScenarioError::Parse(_)), "{json}: {err}");
    }
}

#[test]
fn focus_reads_are_served_in_order_then_fall_back_to_the_focused_window() {
    let mut fake = backend(&format!(
        r#"{{{TWO_WINDOWS},"focus_reads":[
            {{"window":"102","focused_window":"101","focused_element_window":null}},
            {{"window":"102","focused_window":"102","focused_element_window":"101"}}]}}"#
    ));
    let first = fake.read_focus("102").expect("first");
    assert_eq!(
        (
            first.focused_window.as_deref(),
            first.focused_element_window
        ),
        (Some("101"), None)
    );
    let second = fake.read_focus("102").expect("second");
    assert_eq!(second.focused_element_window.as_deref(), Some("101"));
    let fallback = fake.read_focus("102").expect("fallback");
    assert_eq!(
        fallback,
        FakeFocusRead {
            window: "102".to_owned(),
            focused_window: Some("101".to_owned()),
            focused_element_window: Some("101".to_owned()),
        }
    );
    assert_eq!(
        ops_matching(&fake, |op| matches!(op, SinkOp::FocusRead(_))).len(),
        3
    );
}

#[test]
fn focus_records_follow_the_effects_table_and_are_recorded() {
    // Given: short does nothing, full works on its second try, the AX write fails
    let mut fake = v2();
    // When / Then
    assert_eq!(
        fake.record_focus(FocusRecordKind::Short, "102")
            .expect("short"),
        FocusRecordOutcome::NoEffect
    );
    assert_eq!(
        fake.read_focus("102")
            .expect("scripted")
            .focused_window
            .as_deref(),
        Some("101")
    );
    assert_eq!(
        fake.record_focus(FocusRecordKind::Full, "102")
            .expect("full 1"),
        FocusRecordOutcome::NoEffect
    );
    assert!(fake.record_focus(FocusRecordKind::AxWrite, "102").is_err());
    assert_eq!(
        fake.record_focus(FocusRecordKind::Full, "102")
            .expect("full 2"),
        FocusRecordOutcome::TookEffect
    );
    assert_eq!(
        fake.read_focus("102")
            .expect("default")
            .focused_element_window
            .as_deref(),
        Some("102")
    );
    let outcomes: Vec<_> = fake
        .sink()
        .ops()
        .into_iter()
        .filter_map(|op| match op {
            SinkOp::FocusRecord { kind, outcome, .. } => Some((kind, outcome)),
            _ => None,
        })
        .collect();
    assert_eq!(
        outcomes,
        vec![
            (FocusRecordKind::Short, FocusRecordOutcome::NoEffect),
            (FocusRecordKind::Full, FocusRecordOutcome::NoEffect),
            (FocusRecordKind::AxWrite, FocusRecordOutcome::Failed),
            (FocusRecordKind::Full, FocusRecordOutcome::TookEffect),
        ]
    );
}

#[test]
fn hit_read_matches_within_half_a_point_and_records_misses_too() {
    let mut fake = v2();
    let hit = fake
        .hit_read(DesktopPoint { x: 120.4, y: 139.6 })
        .expect("hit")
        .expect("a scripted hit");
    assert_eq!(
        (hit.role.as_str(), hit.label.as_deref(), hit.secure),
        ("textfield", Some("Password"), true)
    );
    assert_eq!(
        fake.hit_read(DesktopPoint { x: 121.0, y: 140.0 })
            .expect("miss"),
        None
    );
    let reads = ops_matching(&fake, |op| matches!(op, SinkOp::HitRead { .. }));
    assert_eq!(reads.len(), 2);
    assert!(matches!(&reads[1], SinkOp::HitRead { hit: None, .. }));
}

#[test]
fn user_input_timeline_lands_past_presses_and_holds_future_ones() {
    let mut fake = backend(&format!(
        r#"{{{TWO_WINDOWS},"frontmost_pid":77,"user_input_timeline":[
            {{"t_ms":-500,"pid":4242,"kind":"key"}},{{"t_ms":3600000,"pid":4242}}]}}"#
    ));
    let presses = fake.user_input().take();
    assert_eq!(presses.presses.len(), 1);
    assert_eq!(
        (presses.presses[0].pid, presses.presses[0].kind),
        (4242, UserPressKind::Key)
    );
    assert!(presses.presses[0].at.elapsed() >= std::time::Duration::from_millis(500));
    assert!(fake.user_input().take().presses.is_empty());
    assert_eq!(fake.frontmost_pid().expect("frontmost"), Some(77));
    assert_eq!(
        fake.sink().ops(),
        vec![SinkOp::FrontmostRead { pid: Some(77) }]
    );
}

#[test]
fn user_input_timeline_press_keeps_press_order_when_taken_late() {
    let fake = backend(r#"{"user_input_timeline":[{"t_ms":50,"pid":2,"kind":"key"}]}"#);
    let scripted = std::time::Instant::now();
    let feed = fake.user_input();
    feed.press(1, UserPressKind::Click);
    // The timeline press is due at most 50 ms after `scripted`; wait past that
    // so it falls due before the next direct press, then take once.
    std::thread::sleep(std::time::Duration::from_millis(51).saturating_sub(scripted.elapsed()));
    feed.press(3, UserPressKind::Click);
    let presses = feed.take().presses;
    let pids: Vec<u32> = presses.iter().map(|press| press.pid).collect();
    assert!(
        presses.windows(2).all(|pair| pair[0].at <= pair[1].at),
        "record out of press order: {pids:?}"
    );
    assert_eq!(pids.len(), 3);
    assert_eq!(
        pids.last(),
        Some(&3),
        "timeline press landed behind a later press: {pids:?}"
    );
}

#[test]
fn user_input_timeline_beyond_an_hour_is_rejected() {
    for t_ms in [3_600_001_i64, -3_600_001, i64::MIN] {
        let err = FakeScenario::from_json(&format!(
            r#"{{"user_input_timeline":[{{"t_ms":{t_ms},"pid":1}}]}}"#
        ))
        .expect_err("out of range");
        assert!(
            err.to_string().contains(&format!("t_ms {t_ms} is outside")),
            "{err}"
        );
    }
    assert!(
        FakeScenario::from_json(r#"{"user_input_timeline":[{"t_ms":3600000,"pid":1}]}"#).is_ok()
    );
}

#[test]
fn nth_zero_is_rejected_for_every_timeline_field() {
    for (field, json) in [
        (
            "identity_changes",
            r#"{"identity_changes":[{"after_call":"capture","nth":0,"window":"101","new_pid":1,"new_processStart":2}]}"#,
        ),
        (
            "epoch_events",
            r#"{"epoch_events":[{"after_call":"capture","nth":0,"reason":"lock"}]}"#,
        ),
        (
            "displays_change",
            r#"{"displays_change":{"after_call":"capture","nth":0,"displays":[]}}"#,
        ),
    ] {
        let json = json.replacen('{', &format!("{{{TWO_WINDOWS},"), 1);
        let err = FakeScenario::from_json(&json).expect_err(field);
        assert!(
            err.to_string()
                .contains(&format!("{field}: nth counts calls from 1")),
            "{err}"
        );
    }
}

#[test]
fn focus_read_of_an_unknown_window_is_window_not_found() {
    let mut fake = backend(&format!("{{{TWO_WINDOWS}}}"));
    let err = fake.read_focus("999").expect_err("unknown window");
    assert_eq!(
        err.code,
        senpi_desktop_core::error::ErrorCode::WindowNotFound
    );
    assert!(fake.sink().ops().is_empty());
}

#[test]
fn ax_node_count_pads_the_tree_and_deadline_is_exposed() {
    let mut fake = v2();
    assert_eq!(fake.ax_deadline_ms(), Some(50));
    let window = fake
        .windows()
        .expect("windows")
        .into_iter()
        .find(|window| window.id == "101")
        .expect("scripted window 101");
    let ax = fake.ax().expect("ax");
    let root = ax.window_root(&window).expect("root");
    assert_eq!(ax.props(&root).expect("props").child_count, 9_999);
    assert_eq!(ax.children(&root).expect("children").len(), 9_999);
}

#[test]
fn ax_node_count_needs_a_scripted_tree() {
    let err = FakeScenario::from_json(&format!(r#"{{{TWO_WINDOWS},"ax_node_count":{{"102":5}}}}"#))
        .expect_err("no tree");
    assert!(
        err.to_string().contains("ax_node_count names window '102'"),
        "{err}"
    );
}

#[test]
fn epoch_events_bump_after_the_nth_call_and_record_the_reason() {
    let mut fake = v2();
    fake.windows().expect("first");
    fake.windows().expect("second");
    assert_eq!(fake.epoch(), 0);
    fake.displays().expect("next call");
    assert_eq!(fake.epoch(), 1);
    fake.bump_epoch(EpochReason::Restart);
    assert_eq!(
        ops_matching(&fake, |op| matches!(op, SinkOp::EpochBumped { .. })),
        vec![
            SinkOp::EpochBumped {
                epoch: 1,
                reason: EpochReason::Lock
            },
            SinkOp::EpochBumped {
                epoch: 2,
                reason: EpochReason::Restart
            },
        ]
    );
}

#[test]
fn displays_change_swaps_the_displays_and_bumps_a_display_epoch() {
    // Given: the display list empties after the first click
    let mut fake = v2();
    assert_eq!(fake.displays().expect("before").len(), 1);
    let click = PointerEvent::Click {
        x: 5.0,
        y: 5.0,
        button: MouseButton::Left,
        count: 1,
        modifiers: Modifiers::default(),
    };
    let frame = FrameGeometry::for_displays(&[]);
    fake.pointer(&Target::Desktop, click, &frame, DeliveryMode::Background)
        .expect("click");
    // When
    let displays = fake.displays().expect("after");
    // Then
    assert!(displays.is_empty());
    assert_eq!(fake.capabilities().display_count, 0);
    assert_eq!(
        ops_matching(&fake, |op| matches!(
            op,
            SinkOp::DisplaysChanged { .. } | SinkOp::EpochBumped { .. }
        )),
        vec![
            SinkOp::DisplaysChanged { count: 0 },
            SinkOp::EpochBumped {
                epoch: 1,
                reason: EpochReason::Display
            }
        ]
    );
}

#[test]
fn stop_marker_is_reported_as_scripted() {
    assert_eq!(v2().stop_marker(), Some("/var/run/senpi-desktop/stop"));
}

#[test]
fn new_hooks_honor_scripted_failures() {
    let mut fake = backend(&format!(
        r#"{{{TWO_WINDOWS},"fail_next":[{{"method":"window_identity","code":"Timeout"}},{{"method":"hit_read","code":"Timeout"}}]}}"#
    ));
    assert!(fake.window_identity("101").is_err());
    assert!(fake.hit_read(DesktopPoint { x: 0.0, y: 0.0 }).is_err());
    assert!(fake.sink().ops().is_empty());
}
