//! The imported scripting fields drive the `Backend` half as their scenarios say.

use omo_computer_core::backend::{
    Backend, CaptureOptions, InputEvent, Route, TaggedInput, Target, WindowFilter,
};
use omo_computer_core::listing::Rect;
use omo_computer_core::params::Point;

use omo_computer_core::error::{ComputerCode, EngineCode};

use crate::{
    fixtures_dir, FakeBackend, FakeScenario, FocusRecordKind, FocusRecordOutcome, UserInputKind,
};

fn fixture(name: &str) -> FakeBackend {
    FakeBackend::new(
        FakeScenario::load(&fixtures_dir().join(name)).unwrap_or_else(|e| panic!("{name}: {e}")),
    )
}

const OPTIONS: CaptureOptions = CaptureOptions {
    cursor: true,
    crosshair: None,
    region: None,
};

fn click() -> TaggedInput {
    TaggedInput {
        event: InputEvent::Button {
            button: omo_computer_core::params::Button::Left,
            down: true,
        },
        tag: 1,
    }
}

#[test]
fn identity_epoch_and_display_scripts_fire_after_their_call() {
    let mut fake = fixture("v2-scripting.json");
    assert_eq!(fake.identity("101"), Some((4242, 1_700_000_000)));
    fake.capture(&Target::Window("101".to_owned()), &OPTIONS)
        .expect("a frame");
    assert_eq!(
        fake.identity("101"),
        Some((5151, 1_700_000_999)),
        "identity_changes after capture"
    );
    let mut epochs = fake.epoch_source();
    fake.windows(&WindowFilter::default())
        .expect("first listing");
    assert_eq!(epochs.next_change(), Ok(None), "nth 2 has not fired");
    fake.windows(&WindowFilter::default())
        .expect("second listing");
    assert_eq!(
        epochs.next_change().ok().flatten().map(|e| e.reason),
        Some("lock".to_owned())
    );
    fake.post_input(&click(), Route::BackgroundWindow)
        .expect("delivered");
    assert_eq!(
        fake.displays().map(|d| d.len()),
        Ok(0),
        "displays_change after click"
    );
    assert_eq!(
        epochs.next_change().ok().flatten().map(|e| e.reason),
        Some("display".to_owned())
    );
}

#[test]
fn faults_delays_and_presses_run_before_the_call() {
    let mut fake = fixture("capture-unavailable.json");
    let refused = fake
        .capture(&Target::Window("101".to_owned()), &OPTIONS)
        .expect_err("scripted");
    assert_eq!(
        (refused.code, refused.reason),
        (EngineCode::CaptureUnavailable, Some("minimized"))
    );
    assert_eq!(
        refused.row().map(|row| row.computer),
        Ok(ComputerCode::CaptureUnavailable),
        "the scripted pair is typed through the table"
    );
    assert!(
        fake.capture(&Target::Window("101".to_owned()), &OPTIONS)
            .is_ok(),
        "one fault, then the script runs"
    );

    let mut slow = fixture("delay-5000ms.json");
    slow.capture(&Target::Desktop, &OPTIONS).expect("a frame");
    assert_eq!(
        slow.clock().now_ms(),
        5000,
        "the delay moves the fake clock, nothing waits"
    );

    let mut user = fixture("user-intervened.json");
    assert!(user.user_inputs().is_empty());
    user.post_input(
        &TaggedInput {
            event: InputEvent::Text("hi".to_owned()),
            tag: 2,
        },
        Route::Ax,
    )
    .expect("typed");
    let inputs = user.user_inputs();
    assert_eq!(
        inputs.iter().map(|i| (i.pid, i.kind)).collect::<Vec<_>>(),
        [(4242, UserInputKind::Click)]
    );
    assert_eq!(
        fixture("v2-scripting.json")
            .user_inputs()
            .first()
            .map(|i| i.at_ms),
        Some(-500)
    );
}

#[test]
fn scripted_reads_follow_their_lists() {
    let mut fake = fixture("v2-scripting.json");
    assert_eq!(fake.focus_read("102").focused_window, "101");
    assert_eq!(
        fake.focus_read("102").focused_window,
        "101",
        "after the list, the focused window"
    );
    let outcomes: Vec<FocusRecordOutcome> = (0..3)
        .map(|_| {
            fake.focus_record(FocusRecordKind::Full, "101")
                .expect("recorded")
        })
        .collect();
    assert_eq!(
        outcomes,
        [
            FocusRecordOutcome::NoEffect,
            FocusRecordOutcome::TookEffect,
            FocusRecordOutcome::TookEffect
        ]
    );
    assert_eq!(fake.sink().len(), 3, "each focus record is one side effect");
    assert!(fake
        .hit_at(Point { x: 120.0, y: 140.0 })
        .is_some_and(|hit| hit.secure));
    assert!(fake.hit_at(Point { x: 121.0, y: 140.0 }).is_none());
    assert_eq!(fake.frontmost_pid(), Some(4242));
    assert_eq!(
        fake.stop_marker().as_deref(),
        Some("/var/run/omo-computer/stop")
    );
    let mut menus = fixture("menus.json");
    assert!(menus
        .menu_select("101", &["File", "Export…", "PDF"])
        .is_ok());
    assert!(
        menus.menu_select("101", &["Edit", "Undo"]).is_err(),
        "a disabled menu refuses"
    );
    assert_eq!(menus.sink().len(), 1);
}

#[test]
fn imported_error_code_faults_keep_their_exact_code_and_row() {
    for name in ["error-codes-amend-1.json", "error-codes-amend-2.json"] {
        let scenario = FakeScenario::load(&fixtures_dir().join(name)).expect("loads");
        let scripted: Vec<EngineCode> = scenario.fail_next.iter().map(|f| f.code).collect();
        let mut fake = FakeBackend::new(scenario);
        for code in scripted {
            let refused = fake.displays().expect_err("scripted");
            assert_eq!(refused.code, code, "{name}");
            let row = refused
                .row()
                .unwrap_or_else(|e| panic!("{name} {code:?}: {e}"));
            assert_eq!(
                row.key.reason, None,
                "{name}: the imported faults are bare codes"
            );
        }
        assert!(fake.displays().is_ok(), "{name}: the queue drains");
        assert!(fake.sink().is_empty());
    }
}

#[test]
fn an_empty_or_negative_extent_refuses_instead_of_a_zero_size_frame() {
    let display = |width: i32, height: i32, scale: f64| {
        format!(
            r#"{{"displays":[{{"id":"1","name":"d","x":0,"y":0,"width":{width},"height":{height},"scale":{scale},"pixelX":0,"pixelY":0,"pixelWidth":1,"pixelHeight":1,"isPrimary":true}}]}}"#
        )
    };
    let region = |width: f64, height: f64| CaptureOptions {
        region: Some(Rect {
            x: 0.0,
            y: 0.0,
            width,
            height,
        }),
        ..OPTIONS
    };
    let cases = [
        ("scale 0", display(100, 100, 0.0), OPTIONS),
        ("zero width", display(0, 100, 1.0), OPTIONS),
        ("negative height", display(100, -5, 1.0), OPTIONS),
        ("zero region", display(100, 100, 1.0), region(0.0, 10.0)),
        (
            "negative region",
            display(100, 100, 1.0),
            region(10.0, -10.0),
        ),
    ];
    for (case, json, options) in cases {
        let mut fake = FakeBackend::from_json(&json).unwrap_or_else(|e| panic!("{case}: {e}"));
        assert_eq!(
            fake.capture(&Target::Desktop, &options)
                .map(|frame| (frame.width, frame.height)),
            Err(omo_computer_core::backend::Refusal::bare(
                EngineCode::CaptureFailed
            )),
            "{case}"
        );
        assert!(
            fake.sink().is_empty(),
            "{case}: a refused capture writes nothing"
        );
    }
    let mut control = FakeBackend::from_json(&display(100, 100, 1.0)).expect("loads");
    let frame = control
        .capture(&Target::Desktop, &region(10.0, 10.0))
        .expect("a positive extent captures");
    assert_eq!((frame.width, frame.height), (10, 10));
}

#[test]
fn non_finite_composite_refuses_before_allocating() {
    // given a display whose scaled extent is not a finite pixel count
    let json = r#"{"displays":[{"id":"1","name":"huge","x":0,"y":0,"width":1e308,"height":1e308,"scale":1e308,"pixelX":0,"pixelY":0,"pixelWidth":1,"pixelHeight":1,"isPrimary":true}]}"#;
    let mut fake = FakeBackend::from_json(json).expect("the scenario loads");
    let options = CaptureOptions {
        cursor: true,
        crosshair: None,
        region: None,
    };
    // when capture asks for that display
    let refused = fake
        .capture(&Target::Desktop, &options)
        .map(|frame| (frame.width, frame.height))
        .expect_err("a non-finite frame is over the cap");
    // then the fake refuses and writes nothing
    assert_eq!(
        refused,
        omo_computer_core::backend::Refusal::bare(EngineCode::CaptureFailed)
    );
    assert!(fake.sink().is_empty());
}

#[test]
fn focus_record_sink_keeps_the_window_id_case() {
    // given a window whose id is not already lowercase
    let json = r#"{"windows":[{"id":"Main","title":"wMain","app":"a","pid":1,"x":0,"y":0,"width":10,"height":10,"focused":true,"elevated":null}]}"#;
    let mut fake = FakeBackend::from_json(json).expect("the scenario loads");
    // when the focus record is written
    fake.focus_record(FocusRecordKind::Short, "Main")
        .expect("recorded");
    // then the sink line keeps the id and still folds the enum names
    assert_eq!(
        fake.sink().lines(),
        ["focus_record kind=short window=Main outcome=tookeffect"]
    );
}
