//! Class check: the actionability tests and the harness they run on never
//! wait on the host's clock. Their timing is fake time; a fixed sleep there
//! only makes a test slower or dependent on how busy the host is.
//!
//! The scan works on tokens, not text: comments and string literals are
//! skipped, and a host wait is flagged however it is spelled or imported
//! (`std::thread::sleep(..)`, a bare `sleep(..)` after `use std::thread::sleep`,
//! `tokio::time::sleep`, `park_timeout`, ...). A `fn sleep` definition and a
//! `.sleep(..)` method call (the fake clock's `BatteryClock::sleep`) are not
//! host waits and pass.

/// Every source file of the actionability tests and the session test harness.
const SOURCES: [(&str, &str); 9] = [
    ("actionability/tests.rs", include_str!("tests.rs")),
    ("actionability/lock_tests.rs", include_str!("lock_tests.rs")),
    (
        "actionability/auto_wait_tests.rs",
        include_str!("auto_wait_tests.rs"),
    ),
    (
        "actionability/no_sleep_tests.rs",
        include_str!("no_sleep_tests.rs"),
    ),
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

/// Names of functions that block on the host's clock.
const HOST_WAITS: [&str; 6] = [
    "sleep",
    "sleep_ms",
    "sleep_until",
    "park_timeout",
    "park_timeout_ms",
    "delay_for",
];

/// Files allowed to wait on the host's clock, each with its reason. None today.
const ALLOWED: [&str; 0] = [];

/// The identifier and punctuation tokens of `source` with their line numbers,
/// skipping whitespace, comments, and string and char literals.
fn tokens(source: &str) -> Vec<(usize, String)> {
    let chars: Vec<char> = source.chars().collect();
    let (mut out, mut line, mut i) = (Vec::new(), 1, 0);
    let at = |index: usize| chars.get(index).copied().unwrap_or('\0');
    while i < chars.len() {
        let c = chars[i];
        if c == '\n' {
            line += 1;
            i += 1;
        } else if c.is_whitespace() {
            i += 1;
        } else if c == '/' && at(i + 1) == '/' {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
        } else if c == '/' && at(i + 1) == '*' {
            i += 2;
            while i < chars.len() && !(chars[i] == '*' && at(i + 1) == '/') {
                line += usize::from(chars[i] == '\n');
                i += 1;
            }
            i += 2;
        } else if c == '"' || (c == 'r' && (at(i + 1) == '"' || at(i + 1) == '#')) {
            let raw = c == 'r';
            let hashes = if raw {
                chars[i + 1..].iter().take_while(|ch| **ch == '#').count()
            } else {
                0
            };
            i += if raw { 2 + hashes } else { 1 };
            loop {
                match at(i) {
                    '\0' => break,
                    '\\' if !raw => i += 2,
                    '"' if chars[i + 1..].iter().take(hashes).all(|ch| *ch == '#') => {
                        i += 1 + hashes;
                        break;
                    }
                    ch => {
                        line += usize::from(ch == '\n');
                        i += 1;
                    }
                }
            }
        } else if c == '\'' && (at(i + 2) == '\'' || (at(i + 1) == '\\' && at(i + 3) == '\'')) {
            i += if at(i + 1) == '\\' { 4 } else { 3 };
        } else if c.is_alphanumeric() || c == '_' {
            let start = i;
            while at(i).is_alphanumeric() || at(i) == '_' {
                i += 1;
            }
            out.push((line, chars[start..i].iter().collect()));
        } else {
            out.push((line, c.to_string()));
            i += 1;
        }
    }
    out
}

/// Each host wait in `source`: a wait name that is neither defined (`fn`)
/// nor called as a method (`.`).
fn host_waits(path: &str, source: &str) -> Vec<String> {
    let tokens = tokens(source);
    tokens
        .iter()
        .enumerate()
        .filter(|(index, (_, token))| {
            let before = index
                .checked_sub(1)
                .map(|previous| tokens[previous].1.as_str());
            HOST_WAITS.contains(&token.as_str()) && !matches!(before, Some("fn" | "."))
        })
        .map(|(_, (line, token))| format!("{path}:{line}: {token}"))
        .collect()
}

#[test]
fn no_actionability_test_or_harness_file_waits_on_the_host_clock() {
    // Given / When
    let offenders: Vec<String> = SOURCES
        .iter()
        .filter(|(path, _)| !ALLOWED.contains(path))
        .flat_map(|(path, source)| host_waits(path, source))
        .collect();
    // Then
    assert!(
        offenders.is_empty(),
        "host waits where time is not under test: {offenders:#?}"
    );
}
