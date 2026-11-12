//! Class check: the actionability tests and the harness they run on never
//! sleep on the host's clock. Their timing is fake time; a fixed sleep there
//! only makes a test slower or dependent on how busy the host is.

/// Every source file of the actionability tests and the session test harness.
const SOURCES: [(&str, &str); 7] = [
    ("actionability/tests.rs", include_str!("tests.rs")),
    ("actionability/lock_tests.rs", include_str!("lock_tests.rs")),
    ("test_support.rs", include_str!("../test_support.rs")),
    (
        "test_support/builders.rs",
        include_str!("../test_support/builders.rs"),
    ),
    (
        "test_support/fake_time.rs",
        include_str!("../test_support/fake_time.rs"),
    ),
    (
        "test_support/panicky.rs",
        include_str!("../test_support/panicky.rs"),
    ),
    (
        "test_support/screen.rs",
        include_str!("../test_support/screen.rs"),
    ),
];

/// Files allowed to sleep on the host's clock, each with its reason. None today.
const ALLOWED: [&str; 0] = [];

#[test]
fn no_actionability_test_or_harness_file_sleeps_on_the_host_clock() {
    // Given: the needle is built so this file never matches itself.
    let needle = ["thread", "::sleep"].concat();
    // When
    let offenders: Vec<String> = SOURCES
        .iter()
        .filter(|(path, _)| !ALLOWED.contains(path))
        .flat_map(|(path, source)| {
            source
                .lines()
                .enumerate()
                .filter(|(_, line)| line.contains(&needle))
                .map(move |(index, line)| format!("{path}:{}: {}", index + 1, line.trim()))
        })
        .collect();
    // Then
    assert!(
        offenders.is_empty(),
        "fixed host sleeps where time is not under test: {offenders:#?}"
    );
}
