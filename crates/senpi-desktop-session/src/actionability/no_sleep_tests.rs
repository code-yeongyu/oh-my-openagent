//! Class check: the files in `SOURCES` contain no direct host wait, by token.
//! A fixed host wait there only makes a test slower or dependent on how busy
//! the host is.
//!
//! The scan works on tokens, not text: comments and string literals are
//! skipped, and a name in `HOST_WAITS` is flagged however it is spelled or
//! imported (`std::thread::sleep(..)`, a bare `sleep(..)` after
//! `use std::thread::sleep`, `tokio::time::timeout(..)`, `rx.recv_timeout(..)`,
//! ...). A `fn` definition of such a name passes, and so does a `.sleep(..)`
//! method call (the fake clock's `BatteryClock::sleep`). `ALLOWED` lists the
//! host waits kept on purpose, per file and name, each with its reason.
//!
//! What it does not guarantee:
//! - It reads only the text of these files, not the code they call. Tests that
//!   open the harness on host time with `opened()` still poll through
//!   `HostClock::sleep` (actionability.rs), a real `std::thread::sleep`, by
//!   design: `a_harness_left_on_host_time_measures_ready_after_ms_on_host_time_too`
//!   and `the_battery_waits_until_the_bounds_hold_still_across_two_reads` in
//!   tests.rs, and `another_engine_sends_input_while_actionability_waits` and
//!   `cancellation_during_actionability_wait_sends_nothing` in lock_tests.rs.
//! - It knows waits by name only: a wait under another name, an unbounded
//!   wait (`recv()`, `join()`, `Child::wait()`) or a busy loop on `Instant`
//!   is not flagged.

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

/// Names of functions and methods that block on the host's clock.
const HOST_WAITS: [&str; 20] = [
    "sleep",
    "sleep_ms",
    "sleep_until",
    "park_timeout",
    "park_timeout_ms",
    "delay_for",
    "recv_timeout",
    "recv_deadline",
    "send_timeout",
    "wait_timeout",
    "wait_timeout_ms",
    "wait_timeout_while",
    "wait_for",
    "wait_until",
    "wait_while_for",
    "wait_while_until",
    "try_lock_for",
    "try_lock_until",
    "timeout",
    "timeout_at",
];

/// Host waits kept on purpose: (file, wait, reason).
const ALLOWED: [(&str, &str, &str); 1] = [(
    "actionability/lock_tests.rs",
    "recv_timeout",
    "a hang guard on engine A's events: it returns when the event arrives",
)];

/// The number of `#` at `chars[start..]`.
fn hashes_at(chars: &[char], start: usize) -> usize {
    chars[start..].iter().take_while(|ch| **ch == '#').count()
}

/// Whether a raw string (`r".."`, `r#".."#`, ...) starts at `chars[i]`; a raw
/// identifier (`r#type`) is not one.
fn raw_string_at(chars: &[char], i: usize) -> bool {
    chars[i] == 'r' && chars.get(i + 1 + hashes_at(chars, i + 1)) == Some(&'"')
}

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
        } else if c == '"' || raw_string_at(&chars, i) {
            let raw = c == 'r';
            let hashes = if raw { hashes_at(&chars, i + 1) } else { 0 };
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

/// Each host wait in `path`'s `source`: a wait name that is neither defined
/// (`fn`), nor the fake clock's `.sleep`, nor allowed for `path`.
fn host_waits(path: &str, source: &str) -> Vec<String> {
    let tokens = tokens(source);
    tokens
        .iter()
        .enumerate()
        .filter(|(index, (_, token))| {
            let before = index
                .checked_sub(1)
                .map(|previous| tokens[previous].1.as_str());
            let fake_clock = before == Some(".") && token == "sleep";
            let allowed = ALLOWED
                .iter()
                .any(|(file, wait, _)| *file == path && wait == token);
            HOST_WAITS.contains(&token.as_str()) && before != Some("fn") && !fake_clock && !allowed
        })
        .map(|(_, (line, token))| format!("{path}:{line}: {token}"))
        .collect()
}

#[test]
fn no_actionability_test_or_harness_file_waits_on_the_host_clock() {
    // Given / When
    let offenders: Vec<String> = SOURCES
        .iter()
        .flat_map(|(path, source)| host_waits(path, source))
        .collect();
    // Then
    assert!(
        offenders.is_empty(),
        "host waits where time is not under test: {offenders:#?}"
    );
}

#[test]
fn a_raw_identifier_does_not_hide_the_host_wait_after_it() {
    // Given: raw strings that only mention a wait, then a raw identifier.
    let source = r###"let s = r#"sleep(d)"#; let t = r##""# sleep(d)"##;
        let r#type = 1; std::thread::sleep(d);"###;
    // When
    let offenders = host_waits("probe.rs", source);
    // Then: only the real call is reported.
    assert_eq!(offenders, ["probe.rs:2: sleep"]);
}

/// One test per host wait: `$source` holds exactly that one wait, `$token`.
macro_rules! host_wait_probes {
    ($($test:ident: $source:literal => $token:literal;)*) => {$(
        #[test]
        fn $test() {
            assert_eq!(host_waits("probe.rs", $source), [concat!("probe.rs:1: ", $token)]);
        }
    )*};
}

host_wait_probes! {
    a_channel_recv_timeout_is_a_host_wait: "rx.recv_timeout(d);" => "recv_timeout";
    a_channel_recv_deadline_is_a_host_wait: "rx.recv_deadline(at);" => "recv_deadline";
    a_channel_send_timeout_is_a_host_wait: "tx.send_timeout(v, d);" => "send_timeout";
    a_condvar_wait_timeout_is_a_host_wait: "cv.wait_timeout(g, d);" => "wait_timeout";
    a_condvar_wait_timeout_ms_is_a_host_wait: "cv.wait_timeout_ms(g, 5);" => "wait_timeout_ms";
    a_condvar_wait_timeout_while_is_a_host_wait:
        "cv.wait_timeout_while(g, d, f);" => "wait_timeout_while";
    a_parking_lot_wait_for_is_a_host_wait: "cv.wait_for(&mut g, d);" => "wait_for";
    a_parking_lot_wait_until_is_a_host_wait: "cv.wait_until(&mut g, at);" => "wait_until";
    a_parking_lot_wait_while_for_is_a_host_wait:
        "cv.wait_while_for(&mut g, f, d);" => "wait_while_for";
    a_parking_lot_wait_while_until_is_a_host_wait:
        "cv.wait_while_until(&mut g, f, at);" => "wait_while_until";
    a_parking_lot_try_lock_for_is_a_host_wait: "m.try_lock_for(d);" => "try_lock_for";
    a_parking_lot_try_lock_until_is_a_host_wait: "m.try_lock_until(at);" => "try_lock_until";
    a_tokio_timeout_is_a_host_wait: "tokio::time::timeout(d, f).await;" => "timeout";
    a_tokio_timeout_at_is_a_host_wait: "tokio::time::timeout_at(at, f).await;" => "timeout_at";
}
