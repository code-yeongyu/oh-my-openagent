//! Row 52's planner and its two shipped tables. Time is an input: every plan is sampled on a virtual
//! clock, nothing sleeps.

use serde_json::Value;

use super::super::look::{Action, CursorLook, LOOK_JSON};
use super::super::units::{InvalidDisplay, PixelPoint, Points, RefreshRate, Scale};
use super::{Display, MotionTable, Plan, Report, Travel, MOTION_JSON};

const PACKAGE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../packages/omo-computer-tool");

fn package_file(name: &str) -> String {
    std::fs::read_to_string(format!("{PACKAGE}/{name}")).unwrap_or_else(|error| panic!("{name}: {error}"))
}

/// A 2x display at 60 Hz: report positions are backing pixels, two per point.
fn display(reduced_motion: bool) -> Display {
    let scale = Scale::new(2.0).unwrap_or_else(|error| panic!("{error}"));
    let refresh = RefreshRate::new(60.0).unwrap_or_else(|error| panic!("{error}"));
    Display { scale, refresh, reduced_motion }
}

fn at(x: f64, y: f64) -> PixelPoint {
    PixelPoint { x, y }
}

fn click(x: f64, y: f64, at_ms: f64) -> Report {
    Report { to: at(x, y), action: Action::Click, at_ms }
}

/// [ADP-65] the glide duration grows with the logarithm of the distance inside 150-450 ms.
#[test]
fn duration_grows_with_distance_and_stays_between_150_and_450_ms() {
    let table = MotionTable::shipped();
    let points = [0.0, 1.0, 16.0, 42.0, 100.0, 240.0, 600.0, 5_000.0, 1.0e6];
    let durations = points.map(|d| table.glide_ms(Points(d)));
    assert!(durations.windows(2).all(|pair| pair[0] <= pair[1]), "{durations:?}");
    assert!(durations.iter().all(|ms| (150.0..=450.0).contains(ms)), "{durations:?}");
    assert!((durations[0] - 150.0).abs() < 1e-9 && (durations[8] - 450.0).abs() < 1e-9, "{durations:?}");
    assert!((table.glide_ms(Points(42.0)) - (150.0 + 75.0 * (1.0 + 42.0 / 16.0_f64).log2())).abs() < 1e-9);
    assert!(table.glide_ms(Points(100.0)) > table.glide_ms(Points(42.0)));

    let plan = Plan::new(at(0.0, 0.0), &click(600.0, 0.0, 0.0), &display(false));
    assert_eq!(plan.travel, Travel::Glide { duration_ms: table.glide_ms(Points(300.0)) }, "600 px at 2x is 300 pt");
}

/// [ADP-65] [ADP-61] one shared planner: eased, monotone, and never a jump at 60 Hz.
#[test]
fn progress_is_monotone_and_no_two_consecutive_samples_at_60_hz_are_further_apart_than_40_percent_of_the_distance() {
    let from = at(10.0, 20.0);
    for (dx, dy) in [(86.0, 0.0), (0.0, 120.0), (300.0, 400.0), (1_000.0, -60.0), (-5_000.0, 3_000.0)] {
        let to = at(from.x + dx, from.y + dy);
        let plan = Plan::new(from, &click(to.x, to.y, 1_000.0), &display(false));
        let samples = plan.samples();
        let total = from.distance(to).0;
        let progress: Vec<f64> = samples.iter().map(|s| from.distance(s.position).0 / total).collect();
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
    let first = Plan::new(at(0.0, 0.0), &click(1_200.0, 0.0, 0.0), &display(false));
    let reached = first.at(100.0).position;
    assert!(reached.x > 0.0 && reached.x < 1_200.0, "{reached:?}");

    let second = first.retarget(&click(1_200.0, 900.0, 100.0), &display(false));
    let samples = second.samples();
    assert_eq!(second.from, reached);
    assert_eq!(samples[0].position, reached);
    assert!((samples[0].at_ms - 100.0).abs() < 1e-9);
    assert_eq!(samples[samples.len() - 1].position, at(1_200.0, 900.0));
}

/// [ADP-65] a hop inside the pointer's own footprint is placed, not glided.
#[test]
fn hop_under_one_cursor_box_draws_no_glide() {
    let from = at(100.0, 100.0);
    let footprint_px = CursorLook::shipped().footprint_pt * 2.0;
    let hop = Plan::new(from, &click(from.x + footprint_px - 2.0, from.y, 0.0), &display(false));
    let samples = hop.samples();
    assert_eq!(hop.travel, Travel::Place);
    assert_eq!(samples.len(), 1);
    assert_eq!(samples[0].position, at(from.x + footprint_px - 2.0, from.y));
    assert!((samples[0].opacity - 1.0).abs() < 1e-9);

    let glide = Plan::new(from, &click(from.x + footprint_px + 2.0, from.y, 0.0), &display(false));
    assert!(matches!(glide.travel, Travel::Glide { .. }), "{:?}", glide.travel);
}

/// [ADP-65] reduced motion: no position between the targets, one fade at the target.
#[test]
fn reduced_motion_fades_at_the_target() {
    let to = at(900.0, 500.0);
    let plan = Plan::new(at(0.0, 0.0), &click(to.x, to.y, 0.0), &display(true));
    let samples = plan.samples();
    assert_eq!(plan.travel, Travel::Fade { duration_ms: MotionTable::shipped().fade_ms });
    assert!(samples.len() >= 2);
    assert!(samples.iter().all(|s| s.position == to), "{samples:?}");
    assert!(samples[0].opacity.abs() < 1e-9 && (samples[samples.len() - 1].opacity - 1.0).abs() < 1e-9);
    assert!(samples.windows(2).all(|pair| pair[1].opacity >= pair[0].opacity));
}

/// The planner divides by the scale and steps by the frame time, so a display value that is not
/// a finite number above zero is refused where the display is parsed.
#[test]
fn display_refuses_a_scale_or_refresh_rate_that_is_not_finite_and_above_zero() {
    for bad in [0.0, -60.0, f64::NAN, f64::INFINITY] {
        assert_eq!(RefreshRate::new(bad).map_err(|error| error.to_string()), Err(InvalidDisplay::RefreshRate(bad).to_string()));
        assert_eq!(Scale::new(bad).map_err(|error| error.to_string()), Err(InvalidDisplay::Scale(bad).to_string()));
    }
    assert!(RefreshRate::new(120.0).is_ok() && Scale::new(1.5).is_ok());
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

/// The shipped table keeps the bounds ordered and every easing control point in `0..=1`, which
/// is what makes the eased progress monotone.
#[test]
fn packaged_motion_table_is_byte_equal_to_the_crate_table() {
    assert_eq!(package_file("cursor-motion.json"), MOTION_JSON);
    let table = MotionTable::shipped();
    assert!(table.min_ms <= table.base_ms && table.base_ms <= table.max_ms, "{table:?}");
    assert!(table.easing.iter().all(|c| (0.0..=1.0).contains(c)), "{:?}", table.easing);
}

/// [ADP-61] one look: a badge for every word of the action vocabulary, and four distinct
/// session colours a renderer can draw without a theme.
#[test]
fn packaged_cursor_look_is_byte_equal_to_the_crate_description() {
    assert_eq!(package_file("cursor-look.json"), LOOK_JSON);
    let look = CursorLook::shipped();
    assert_eq!(look.badges, Action::ALL);
    let hex = |c: &String| c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|d| d.is_ascii_hexdigit());
    assert!(look.session_colours.iter().all(hex), "{:?}", look.session_colours);
    let mut distinct = look.session_colours.to_vec();
    distinct.sort();
    distinct.dedup();
    assert_eq!(distinct.len(), look.session_colours.len(), "{:?}", look.session_colours);
}
