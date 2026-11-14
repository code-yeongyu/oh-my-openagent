//! `settle_constants_live_in_one_table`: the table holds exactly the design's regimes, and no
//! session source outside its tests names a settle duration, declares a settle constant or
//! sleeps. Each needle is split so this file does not match itself.

use std::path::{Path, PathBuf};

use omo_computer_core::settle_profile::{RegimeNumbers, SettleRegime, SETTLE_PROFILE};

const DURATIONS: &[&str] = &[
    "150", "500", "600", "1000", "1_000", "2000", "2_000", "20", "50",
];
const NAMES: &[&str] = &["SETTLE", "QUIET", "TICK", "ATTRIBUTION"];
const WAITS: &[&str] = &[concat!("sle", "ep("), concat!("thread::", "park")];

fn rust_files(dir: &Path, out: &mut Vec<PathBuf>) {
    for entry in std::fs::read_dir(dir).expect("a readable source dir") {
        let path = entry.expect("a readable entry").path();
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        if path.is_dir() {
            if name != "tests" {
                rust_files(&path, out);
            }
        } else if name.ends_with(".rs") && !name.ends_with("tests.rs") {
            out.push(path);
        }
    }
}

/// `needle` occurs in `line` as a whole token.
fn token(line: &str, needle: &str) -> bool {
    let word = |c: char| c.is_alphanumeric() || c == '_';
    line.match_indices(needle).any(|(at, _)| {
        !line[..at].chars().next_back().is_some_and(word)
            && !line[at + needle.len()..].chars().next().is_some_and(word)
    })
}

fn settle_owned(path: &Path) -> bool {
    let text = path.to_string_lossy();
    text.contains("/settle/") || text.ends_with("wait_for.rs") || text.ends_with("attribution.rs")
}

fn findings(path: &Path, text: &str) -> Vec<String> {
    let owned = settle_owned(path);
    let mut found = Vec::new();
    for (index, line) in text.lines().enumerate() {
        let code = line.trim_start();
        if code.starts_with("//") {
            continue;
        }
        let at = format!("{}:{}", path.display(), index + 1);
        if code.contains("const ")
            && NAMES.iter().any(|name| code.contains(name))
            && code.contains("u64")
        {
            found.push(format!("{at}: a settle constant outside settle_profile.rs"));
        }
        if owned {
            found.extend(
                DURATIONS
                    .iter()
                    .filter(|d| token(code, d))
                    .map(|d| format!("{at}: duration {d}")),
            );
            found.extend(
                WAITS
                    .iter()
                    .filter(|w| code.contains(*w))
                    .map(|w| format!("{at}: {w}")),
            );
        }
    }
    found
}

#[test]
fn settle_constants_live_in_one_table() {
    assert_eq!(SettleRegime::Changed.numbers().quiet_ms, 150);
    assert_eq!(
        SettleRegime::Unchanged.numbers(),
        RegimeNumbers {
            quiet_ms: 500,
            cap_ms: 1_000
        }
    );
    assert_eq!(
        SettleRegime::Navigation.numbers(),
        RegimeNumbers {
            quiet_ms: 600,
            cap_ms: 2_000
        }
    );
    assert_eq!(SETTLE_PROFILE.tick_ms, 20);
    let mut files = Vec::new();
    rust_files(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("src"),
        &mut files,
    );
    assert!(
        files.iter().any(|path| settle_owned(path)),
        "the settle sources are scanned"
    );
    let found: Vec<String> = files
        .iter()
        .flat_map(|path| {
            findings(
                path,
                &std::fs::read_to_string(path).expect("a readable source"),
            )
        })
        .collect();
    assert!(found.is_empty(), "{found:#?}");
}
