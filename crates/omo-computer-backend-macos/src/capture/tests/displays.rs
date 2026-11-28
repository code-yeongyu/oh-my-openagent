//! `displays()` on a 1x + 2x two-display fixture (design row M19).

use omo_computer_core::backend::WindowFilter;
use omo_computer_core::results::DisplayInfo;

use super::kit::{rect, window, FakeOs, OWN_PID};
use crate::capture::types::DisplayRecord;
use crate::capture::Capturer;

fn two_displays() -> FakeOs {
    let mut right = window(3, 30);
    right.bounds = rect(1600.0, 100.0, 300.0, 200.0);
    let mut os = FakeOs::with_windows(vec![window(2, 20), right]);
    os.displays = vec![
        DisplayRecord {
            id: 2,
            bounds: rect(1440.0, 0.0, 1920.0, 1080.0),
            pixel_width: 1920,
            pixel_height: 1080,
            main: false,
        },
        DisplayRecord {
            id: 1,
            bounds: rect(0.0, 0.0, 1440.0, 900.0),
            pixel_width: 2880,
            pixel_height: 1800,
            main: true,
        },
    ];
    os
}

#[test]
fn displays_complete_on_two_display_fixture() {
    let mut capturer = Capturer::new(two_displays(), OWN_PID);
    let displays = capturer.displays().expect("displays");
    assert_eq!(
        displays,
        vec![
            DisplayInfo {
                id: "1".into(),
                bounds: rect(0.0, 0.0, 1440.0, 900.0),
                scale: 2.0,
                primary: true,
                truncated: None
            },
            DisplayInfo {
                id: "2".into(),
                bounds: rect(1440.0, 0.0, 1920.0, 1080.0),
                scale: 1.0,
                primary: false,
                truncated: None
            },
        ]
    );
    let windows = capturer.windows(&WindowFilter::default()).expect("windows");
    let placed: Vec<_> = windows
        .windows
        .iter()
        .map(|w| (w.id.as_str(), w.display.as_str()))
        .collect();
    assert_eq!(
        placed,
        vec![("2", "1"), ("3", "2")],
        "each window on the display holding its centre"
    );
}
