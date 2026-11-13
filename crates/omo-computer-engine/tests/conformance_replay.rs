//! Row 28: every imported conformance case the provenance manifest lists is replayed against the
//! engine binary byte-equal modulo its `variable` pointers and the ORACLE-DELTAS ledger, and the
//! ledger itself is checked: a line that matched nothing across these cases and the v1 consumer
//! corpus is stale and fails.

#[path = "common/case.rs"]
mod case;
#[path = "common/compare.rs"]
mod compare;
#[allow(dead_code, reason = "this binary only replays host blocks; it scripts no host itself")]
#[path = "common/host.rs"]
mod host;
#[path = "common/peer.rs"]
mod peer;
#[path = "common/replay.rs"]
mod replay;

use std::collections::BTreeMap;
use std::fs;

use case::repo;
use replay::{replay, Report};

const CONFORMANCE: &str = "crates/omo-computer-core/fixtures/conformance/";
const V1_CONSUMERS: &str = "crates/omo-computer-engine/tests/fixtures/v1-consumers/";
const DAEMON_CASE: &str = "09-oneshot-daemon-session.json";

fn provenance_cases() -> Vec<String> {
    let manifest = fs::read_to_string(repo().join("crates/omo-computer-core/parity/ORACLE-PROVENANCE.tsv"))
        .expect("the provenance manifest is readable");
    manifest
        .lines()
        .skip(1)
        .filter_map(|row| row.split('\t').next())
        .filter(|path| path.starts_with(CONFORMANCE) || path.starts_with(V1_CONSUMERS))
        .filter(|path| path.ends_with(".json") && !path.ends_with(DAEMON_CASE) && !path.contains("/scenarios/"))
        .map(str::to_owned)
        .collect()
}

fn imported(name: &str) -> String {
    format!("{CONFORMANCE}{name}")
}

macro_rules! imported_case {
    ($($test:ident => $file:literal;)+) => {
        $(#[test]
        fn $test() {
            replay(&imported($file)).assert_clean();
        })+

        const NAMED: &[&str] = &[$($file,)+];
    };
}

imported_case! {
    action_report_legacy => "action-report-legacy.json";
    action_report_object => "action-report-object.json";
    ax_type_text => "ax-type-text.json";
    ax_unconfirmed => "ax-unconfirmed.json";
    bounded_holds_closed => "bounded-holds-closed.json";
    cancel => "cancel.json";
    capabilities => "capabilities.json";
    capture_budget => "capture-budget.json";
    capture_legacy => "capture-legacy.json";
    capture_unavailable => "capture-unavailable.json";
    cursor_display_only => "cursor-display-only.json";
    error_codes_amend_1 => "error-codes-amend-1.json";
    error_codes_amend_2 => "error-codes-amend-2.json";
    frame_invalidation => "frame-invalidation.json";
    hello => "hello.json";
    rejections => "rejections.json";
    remote_typing => "remote-typing.json";
    session_options_additive => "session-options-additive.json";
    stale_ref => "stale-ref.json";
    stop_path_ladder => "stop-path-ladder.json";
    stop_path_policy => "stop-path-policy.json";
    user_intervened => "user-intervened.json";
}

#[test]
fn the_named_cases_are_exactly_the_22_the_manifest_imports() {
    let mut listed: Vec<String> =
        provenance_cases().into_iter().filter_map(|path| path.strip_prefix(CONFORMANCE).map(str::to_owned)).collect();
    listed.sort();
    let mut named: Vec<String> = NAMED.iter().map(|name| (*name).to_owned()).collect();
    named.sort();
    assert_eq!(named.len(), 22, "row 3 imported 22 cases");
    assert_eq!(listed, named, "a manifest case without its own test, or a test the manifest does not list");
}

#[test]
fn full_replay_passes_with_the_ledger_and_reports_every_delta_line_used() {
    let reports: Vec<Report> = provenance_cases().iter().map(|name| replay(name)).collect();
    let mut matched: BTreeMap<String, usize> = BTreeMap::new();
    for report in &reports {
        for delta in &report.deltas {
            *matched.entry(delta.line.clone()).or_default() += delta.matched;
        }
    }
    let ledger = fs::read_to_string(repo().join(compare::DELTAS)).expect("the delta ledger is readable");
    let mut stale = Vec::new();
    for line in ledger.lines().skip(1).filter(|line| !line.trim().is_empty()) {
        let count = matched.get(line).copied().unwrap_or(0);
        println!("DELTA matched={count} {line}");
        if count == 0 {
            stale.push(line.to_owned());
        }
    }
    let failing: Vec<String> = reports
        .iter()
        .filter(|report| !report.failures.is_empty())
        .map(|report| format!("{}:\n  {}", report.name, report.failures.join("\n  ")))
        .collect();
    assert!(failing.is_empty(), "{} case(s) did not replay clean:\n{}", failing.len(), failing.join("\n"));
    assert!(stale.is_empty(), "stale ORACLE-DELTAS line(s), matched nothing:\n{}", stale.join("\n"));
}
