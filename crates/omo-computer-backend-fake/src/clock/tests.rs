use crate::time_guard::{scan_crate_sources, scan_text, FORBIDDEN};
use crate::FakeClock;

#[test]
fn fake_clock_is_the_only_time_source() {
    let report = scan_crate_sources();
    assert!(
        report.files_scanned >= 10,
        "the guard scans the crate sources: {report:?}"
    );
    assert!(report.findings.is_empty(), "{:#?}", report.findings);
    for needle in FORBIDDEN {
        let text = format!("let now = {needle};");
        assert_eq!(
            scan_text("probe.rs", &text).len(),
            1,
            "the guard catches {needle}"
        );
    }

    let clock = FakeClock::from_seam(Some("1000")).expect("a millisecond start");
    assert_eq!(clock.now_ms(), 1000);
    assert_eq!(clock.now_ms(), 1000, "time never moves on its own");
    assert_eq!(clock.advance(5), 1005);
    assert_eq!(clock.clone().now_ms(), 1005, "clones share one clock");
    assert!(FakeClock::from_seam(Some("soon")).is_err());
    assert_eq!(FakeClock::from_seam(None).expect("unset").now_ms(), 0);
}
