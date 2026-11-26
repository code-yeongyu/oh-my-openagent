//! Row 52's planner and its two shipped tables. Time is an input: every plan is sampled on a virtual
//! clock, nothing sleeps.

use serde_json::Value;

use super::super::look::{Action, CursorLook, LOOK_JSON};
use super::{Display, MotionTable, Plan, Point, Report, Travel, MOTION_JSON};

const PACKAGE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../packages/omo-computer-tool");

fn package_file(name: &str) -> String {
    std::fs::read_to_string(format!("{PACKAGE}/{name}")).unwrap_or_else(|error| panic!("{name}: {error}"))
}

/// A 2x display at 60 Hz: report points are backing pixels, two per point.
fn display(reduced_motion: bool) -> Display {
    Display { scale: 2.0, refresh_hz: 60.0, reduced_motion }
}

fn click(x: f64, y: f64, at_ms: f64) -> Report {
    Report { to: Point { x, y }, action: Action::Click, at_ms }
}

fn distance(a: Point, b: Point) -> f64 {
    (b.x - a.x).hypot(b.y - a.y)
}

/// [ADP-65] the glide duration grows with the logarithm of the distance inside 150-450 ms.
#[test]
fn duration_grows_with_distance_and_stays_between_150_and_450_ms() {
    let table = MotionTable::shipped();
    let points = [0.0, 1.0, 16.0, 42.0, 100.0, 240.0, 600.0, 5_000.0, 1.0e6];
    let durations = points.map(|d| table.glide_ms(d));
    assert!(durations.windows(2).all(|pair| pair[0] <= pair[1]), "{durations:?}");
    assert!(durations.iter().all(|ms| (150.0..=450.0).contains(ms)), "{durations:?}");
    assert!((durations[0] - 150.0).abs() < 1e-9 && (durations[8] - 450.0).abs() < 1e-9, "{durations:?}");
    assert!((table.glide_ms(42.0) - (150.0 + 75.0 * (1.0 + 42.0 / 16.0_f64).log2())).abs() < 1e-9);
    assert!(table.glide_ms(100.0) > table.glide_ms(42.0));

    let plan = Plan::new(Point { x: 0.0, y: 0.0 }, &click(600.0, 0.0, 0.0), &display(false));
    assert_eq!(plan.travel, Travel::Glide { duration_ms: table.glide_ms(300.0) }, "distance is in points");
}

/// [ADP-65] [ADP-61] one shared planner: eased, monotone, and never a jump at 60 Hz.
#[test]
fn progress_is_monotone_and_no_two_consecutive_samples_at_60_hz_are_further_apart_than_40_percent_of_the_distance() {
    let from = Point { x: 10.0, y: 20.0 };
    for (dx, dy) in [(86.0, 0.0), (0.0, 120.0), (300.0, 400.0), (1_000.0, -60.0), (-5_000.0, 3_000.0)] {
        let to = Point { x: from.x + dx, y: from.y + dy };
        let plan = Plan::new(from, &click(to.x, to.y, 1_000.0), &display(false));
        let samples = plan.samples();
        let total = distance(from, to);
        let progress: Vec<f64> = samples.iter().map(|s| distance(from, s.position) / total).collect();
        assert!(matches!(plan.travel, Travel::Glide { .. }), "{dx},{dy}: {:?}", plan.travel);
        assert!(progress.len() >= 9, "{dx},{dy}: {} samples", progress.len());
        assert!(progress[0].abs() < 1e-9 && (progress[progress.len() - 1] - 1.0).abs() < 1e-9, "{progress:?}");
        assert!(progress.windows(2).all(|pair| pair[1] >= pair[0]), "{dx},{dy} not monotone: {progress:?}");
        let largest = progress.windows(2).map(|pair| pair[1] - pair[0]).fold(0.0, f64::max);
        assert!(largest <= 0.40, "{dx},{dy}: a {largest:.3} step");
        assert!(samples.iter().all(|s| (s.opacity - 1.0).abs() < 1e-9));
    }
}

/// [ADP-65] the newest report wins and the cursor carries on from where it is.
#[test]
fn newer_report_retargets_from_the_point_reached() {
    let a = Point { x: 0.0, y: 0.0 };
    let first = Plan::new(a, &click(1_200.0, 0.0, 0.0), &display(false));
    let reached = first.at(100.0).position;
    assert!(reached.x > 0.0 && reached.x < 1_200.0, "{reached:?}");

    let second = first.retarget(&click(1_200.0, 900.0, 100.0), &display(false));
    let samples = second.samples();
    assert_eq!(second.from, reached);
    assert_eq!(samples[0].position, reached);
    assert!((samples[0].at_ms - 100.0).abs() < 1e-9);
    assert_eq!(samples[samples.len() - 1].position, Point { x: 1_200.0, y: 900.0 });
}

/// [ADP-65] a hop inside the pointer's own footprint is placed, not glided.
#[test]
fn hop_under_one_cursor_box_draws_no_glide() {
    let from = Point { x: 100.0, y: 100.0 };
    let footprint_px = CursorLook::shipped().footprint_pt * 2.0;
    let hop = Plan::new(from, &click(from.x + footprint_px - 2.0, from.y, 0.0), &display(false));
    let samples = hop.samples();
    assert_eq!(hop.travel, Travel::Place);
    assert_eq!(samples.len(), 1);
    assert_eq!(samples[0].position, Point { x: from.x + footprint_px - 2.0, y: from.y });
    assert!((samples[0].opacity - 1.0).abs() < 1e-9);

    let glide = Plan::new(from, &click(from.x + footprint_px + 2.0, from.y, 0.0), &display(false));
    assert!(matches!(glide.travel, Travel::Glide { .. }), "{:?}", glide.travel);
}

/// [ADP-65] reduced motion: no position between the targets, one fade at the target.
#[test]
fn reduced_motion_fades_at_the_target() {
    let to = Point { x: 900.0, y: 500.0 };
    let plan = Plan::new(Point { x: 0.0, y: 0.0 }, &click(to.x, to.y, 0.0), &display(true));
    let samples = plan.samples();
    assert_eq!(plan.travel, Travel::Fade { duration_ms: MotionTable::shipped().fade_ms });
    assert!(samples.len() >= 2);
    assert!(samples.iter().all(|s| s.position == to), "{samples:?}");
    assert!(samples[0].opacity.abs() < 1e-9 && (samples[samples.len() - 1].opacity - 1.0).abs() < 1e-9);
    assert!(samples.windows(2).all(|pair| pair[1].opacity >= pair[0].opacity));
}

fn generated_literal(module: &str, name: &str) -> Value {
    let marker = format!("export const {name} = ");
    let start = module.find(&marker).map(|at| at + marker.len()).unwrap_or_else(|| panic!("{name} missing"));
    let end = module.rfind(" as const").unwrap_or_else(|| panic!("{name} is not `as const`"));
    serde_json::from_str(&module[start..end]).unwrap_or_else(|error| panic!("{name}: {error}"))
}

#[test]
fn generated_typescript_table_equals_the_json_table() {
    for (module, name, table) in [
        ("src/cursor-motion.generated.ts", "CURSOR_MOTION", MOTION_JSON),
        ("src/cursor-look.generated.ts", "CURSOR_LOOK", LOOK_JSON),
    ] {
        let crate_table: Value = serde_json::from_str(table).unwrap_or_else(|error| panic!("{name}: {error}"));
        assert_eq!(generated_literal(&package_file(module), name), crate_table, "{module}");
    }
}

#[test]
fn packaged_motion_table_is_byte_equal_to_the_crate_table() {
    assert_eq!(package_file("cursor-motion.json"), MOTION_JSON);
    assert_eq!(MotionTable::shipped().v, 1);
}

/// [ADP-61] one look: four session colours and a badge for every word of the action vocabulary.
#[test]
fn packaged_cursor_look_is_byte_equal_to_the_crate_description() {
    assert_eq!(package_file("cursor-look.json"), LOOK_JSON);
    let look = CursorLook::shipped();
    assert_eq!(look.badges, Action::ALL);
    assert_eq!(look.session_colours.len(), 4);
}
