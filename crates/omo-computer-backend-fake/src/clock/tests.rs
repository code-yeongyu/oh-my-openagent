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

#[test]
fn the_fake_reads_no_environment() {
    for probe in [
        // Split like the needles, so the crate scan above stays clean.
        concat!("let home = std", "::en", "v::var(\"HOME\");"),
        concat!("use std", "::env;"),
        concat!("let seam = env", "::var_os(\"OMO_COMPUTER_FAKE_CLOCK\");"),
        // A grouped import, then a module call: neither names the module with its crate path.
        concat!("use std::{e", "nv, fs};"),
        concat!("let args = e", "nv::args();"),
        concat!("let tmp = e", "nv::temp_dir();"),
        concat!("use std::{fs, e", "nv};"),
        concat!("use std::{fs, e", "nv as ambient};"),
        // The same groups split across lines, as rustfmt lays out a long group.
        concat!(
            "use std::{\n    e",
            "nv as ambient,\n};\nlet home = ambient::var(\"HOME\");"
        ),
        concat!("use std::{\n    fs,\n    e", "nv,\n};"),
        concat!("use std::{\n    io::{self, Read},\n    e", "nv::args,\n};"),
    ] {
        assert!(
            !scan_text("probe.rs", probe).is_empty(),
            "the guard catches {probe}"
        );
    }
    for clean in [
        concat!("let dir = e", "nv!(\"CARGO_MANIFEST_DIR\");"),
        "let gate_env = 1;",
        concat!("use crate::gate_e", "nv::Seam;"),
        "use std::{\n    fs,\n    io::{self, Read},\n};\nlet gate_env = 1;",
    ] {
        assert!(
            scan_text("probe.rs", clean).is_empty(),
            "no finding for {clean}"
        );
    }
}
