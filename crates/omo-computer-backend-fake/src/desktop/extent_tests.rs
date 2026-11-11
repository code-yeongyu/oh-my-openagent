//! Capture extents: a frame whose pixel size is not a positive, finite count under the
//! composite cap refuses `CaptureFailed` before allocating and writes no sink line.

use omo_computer_core::backend::{Backend, CaptureOptions, Refusal, Target};
use omo_computer_core::error::EngineCode;
use omo_computer_core::listing::Rect;

use crate::FakeBackend;

const OPTIONS: CaptureOptions = CaptureOptions {
    cursor: true,
    crosshair: None,
    region: None,
};

fn display(width: f64, height: f64, scale: f64) -> String {
    format!(
        r#"{{"displays":[{{"id":"1","name":"d","x":0,"y":0,"width":{width},"height":{height},"scale":{scale},"pixelX":0,"pixelY":0,"pixelWidth":1,"pixelHeight":1,"isPrimary":true}}]}}"#
    )
}

fn region(width: f64, height: f64) -> CaptureOptions {
    CaptureOptions {
        region: Some(Rect {
            x: 0.0,
            y: 0.0,
            width,
            height,
        }),
        ..OPTIONS
    }
}

fn refuses(case: &str, json: &str, options: &CaptureOptions) {
    let mut fake = FakeBackend::from_json(json).unwrap_or_else(|e| panic!("{case}: {e}"));
    assert_eq!(
        fake.capture(&Target::Desktop, options)
            .map(|frame| (frame.width, frame.height)),
        Err(Refusal::bare(EngineCode::CaptureFailed)),
        "{case}"
    );
    assert!(
        fake.sink().is_empty(),
        "{case}: a refused capture writes nothing"
    );
}

#[test]
fn a_sub_pixel_extent_refuses_and_truncation_keeps_whole_pixels() {
    refuses(
        "width 0.5 px",
        &display(100.0, 100.0, 1.0),
        &region(0.5, 10.0),
    );
    refuses(
        "height 0.99 px",
        &display(100.0, 100.0, 1.0),
        &region(10.0, 0.99),
    );
    refuses(
        "0.4 x 2.0 scale",
        &display(100.0, 100.0, 2.0),
        &region(0.4, 10.0),
    );
    let mut fake = FakeBackend::from_json(&display(100.0, 100.0, 1.0)).expect("loads");
    let frame = fake
        .capture(&Target::Desktop, &region(1.5, 2.9))
        .expect("at least one whole pixel captures");
    assert_eq!(
        (frame.width, frame.height),
        (1, 2),
        "lengths truncate to whole pixels"
    );
}

#[test]
fn a_negative_scale_or_size_refuses_before_multiplying() {
    refuses(
        "negative size times negative scale",
        &display(-100.0, -100.0, -1.0),
        &OPTIONS,
    );
    refuses("negative scale", &display(100.0, 100.0, -1.0), &OPTIONS);
    refuses(
        "negative region times negative scale",
        &display(100.0, 100.0, -1.0),
        &region(-10.0, -10.0),
    );
    refuses(
        "negative region width",
        &display(100.0, 100.0, 1.0),
        &region(-10.0, 10.0),
    );
    refuses("NaN scale", &display(100.0, 100.0, f64::NAN), &OPTIONS);
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
