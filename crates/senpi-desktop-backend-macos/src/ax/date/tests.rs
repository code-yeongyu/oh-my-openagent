use super::{format_local, parse, DateRequest};

/// 2026-09-25T17:00:00+02:00.
const SEPT_25_17H_CEST: f64 = 812_041_200.0;
/// 2026-03-29T01:00:00Z, when Central European summer time starts.
const CEST_FROM: f64 = 796_438_800.0;
/// 2026-10-25T01:00:00Z, when Central European summer time ends.
const CET_FROM: f64 = 814_582_800.0;

/// Central European time: +02:00 from `CEST_FROM` to `CET_FROM`, else +01:00.
fn berlin(at: f64) -> i64 {
    if (CEST_FROM..CET_FROM).contains(&at) {
        7200
    } else {
        3600
    }
}

fn resolve(text: &str, current: f64) -> Result<f64, String> {
    let request = parse(text).unwrap_or_else(|| panic!("{text:?} was refused"));
    request.absolute_time(current, berlin)
}

fn write(text: &str, current: f64) -> String {
    let at = resolve(text, current).unwrap_or_else(|error| panic!("{text:?}: {error}"));
    format_local(at, berlin)
}

fn refusal(text: &str, current: f64) -> String {
    match resolve(text, current) {
        Ok(at) => panic!("{text:?} was written as {}", format_local(at, berlin)),
        Err(reason) => reason,
    }
}

#[test]
fn a_date_keeps_the_controls_local_time_of_day() {
    assert_eq!(write("2026-10-05", SEPT_25_17H_CEST), "2026-10-05T17:00:00+02:00");
    // Across the change to winter time the wall clock stays at 17:00.
    assert_eq!(write("2026-12-24", SEPT_25_17H_CEST), "2026-12-24T17:00:00+01:00");
    assert_eq!(write("2024-02-29", SEPT_25_17H_CEST), "2024-02-29T17:00:00+01:00");
}

#[test]
fn a_local_time_skipped_by_daylight_saving_is_refused() {
    let skipped = refusal("2026-03-29T02:30", SEPT_25_17H_CEST);
    assert!(skipped.contains("2026-03-29T02:30:00 does not exist"), "{skipped}");
    // A day whose kept time of day (02:30) falls in the skipped hour.
    let kept = refusal("2026-03-29", SEPT_25_17H_CEST - 14.5 * 3600.0);
    assert!(kept.contains("2026-03-29T02:30:00 does not exist"), "{kept}");
    assert_eq!(write("2026-03-29T01:59:59", 0.0), "2026-03-29T01:59:59+01:00");
    assert_eq!(write("2026-03-29T03:00", 0.0), "2026-03-29T03:00:00+02:00");
}

#[test]
fn a_local_time_repeated_as_clocks_go_back_is_refused_naming_both_offsets() {
    let repeated = refusal("2026-10-25T02:30", SEPT_25_17H_CEST);
    assert!(
        repeated.contains("2026-10-25T02:30:00 occurs twice")
            && repeated.contains("add +02:00 for the first or +01:00 for the second"),
        "{repeated}"
    );
    assert_eq!(write("2026-10-25T02:30+02:00", 0.0), "2026-10-25T02:30:00+02:00");
    assert_eq!(write("2026-10-25T02:30+01:00", 0.0), "2026-10-25T02:30:00+01:00");
    assert_eq!(write("2026-10-25T01:59:59", 0.0), "2026-10-25T01:59:59+02:00");
    assert_eq!(write("2026-10-25T03:00", 0.0), "2026-10-25T03:00:00+01:00");
}

#[test]
fn a_date_time_without_offset_is_local_wall_clock() {
    assert_eq!(write("2026-10-05T09:30", SEPT_25_17H_CEST), "2026-10-05T09:30:00+02:00");
    assert_eq!(
        write("2026-12-21T09:30:15", SEPT_25_17H_CEST),
        "2026-12-21T09:30:15+01:00"
    );
    assert_eq!(
        write("2026-12-21 23:59:59.5", SEPT_25_17H_CEST),
        "2026-12-21T23:59:59+01:00"
    );
}

#[test]
fn a_date_time_with_offset_is_that_instant() {
    assert_eq!(
        write("2026-10-05T07:30Z", SEPT_25_17H_CEST),
        "2026-10-05T09:30:00+02:00"
    );
    assert_eq!(write("2026-10-05T09:30:00-04:00", 0.0), "2026-10-05T15:30:00+02:00");
    assert_eq!(write("2026-10-05T07:30:00.000Z", 0.0), "2026-10-05T09:30:00+02:00");
    assert_eq!(parse("2001-01-01T00:00:00Z"), Some(DateRequest::Instant(0.0)));
}

#[test]
fn the_form_the_tree_prints_is_accepted_back() {
    assert_eq!(write("2026-09-28 04:00:00 +0000", 0.0), "2026-09-28T06:00:00+02:00");
    assert_eq!(write("2026-09-28 04:00:00 -0400", 0.0), "2026-09-28T10:00:00+02:00");
    assert_eq!(write("2026-09-28T04:00+0530", 0.0), "2026-09-28T00:30:00+02:00");
}

#[test]
fn the_date_a_refusal_quotes_is_accepted_back() {
    for at in [SEPT_25_17H_CEST, CET_FROM, CET_FROM - 1.0, -86_400.0 * 400.0] {
        let rendered = format_local(at, berlin);
        assert_eq!(write(&rendered, SEPT_25_17H_CEST), rendered);
    }
}

#[test]
fn anything_else_is_refused() {
    for text in [
        "",
        "10/05/2026",
        "05.10.2026",
        "October 5, 2026",
        "2026-10-5",
        "2026-13-01",
        "2026-02-29",
        "2026-09-31",
        "2026-10-05T",
        "2026-10-05T9:30",
        "2026-10-05T24:00",
        "2026-10-05T09:60",
        "2026-10-05T09:30:60",
        "2026-10-05T09:30:00.",
        "2026-10-05T09:30.5",
        "2026-10-05T09:30+2",
        "2026-10-05T09:30+020",
        "2026-10-05T09:30:00  +0000",
        "2026-10-05T09:30:00+24:00",
        "2026-10-05x09:30",
        "20261005",
        "tomorrow",
    ] {
        assert_eq!(parse(text), None, "{text:?} was accepted");
    }
}
