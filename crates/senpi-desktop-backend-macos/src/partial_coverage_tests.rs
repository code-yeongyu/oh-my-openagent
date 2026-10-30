//! Every background entry point runs under `skylight::reporting_partial`
//! (#11459): one outside it could report input that already went out as
//! `BackgroundUnavailable`, which the host reruns in the foreground. A new
//! `DeliveryMode::Background` arm anywhere in the crate is caught by the scan;
//! a new AX request entry point extends [`AX_ENTRY_POINTS`].

use std::fs;
use std::path::{Path, PathBuf};

/// How a background arm may start: the `MacInput::background` wrapper or a
/// direct `reporting_partial` call.
const BACKGROUND_WRAPPERS: [&str; 3] = [
    "self.background(",
    "skylight::reporting_partial(",
    "crate::skylight::reporting_partial(",
];

/// The background arms that exist today, as `file: count`.
const BACKGROUND_ARMS: [(&str, usize); 3] = [("input/mod.rs", 3), ("input/holds.rs", 1), ("backend.rs", 1)];

/// The AX requests the model makes, each a background call of its own.
const AX_ENTRY_POINTS: [(&str, &str); 3] =
    [("ax/actions.rs", "perform_requested"), ("ax/actions.rs", "set_value"), ("ax/actions.rs", "focus")];

const ARM: &str = "DeliveryMode::Background =>";

fn sources(dir: &Path, found: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(dir).expect("the crate's src directory is readable") {
        let path = entry.expect("a src directory entry is readable").path();
        let name = path.file_name().and_then(|name| name.to_str()).unwrap_or_default();
        if path.is_dir() {
            sources(&path, found);
        } else if name.ends_with(".rs") && !name.contains("test") {
            found.push(path);
        }
    }
}

fn src() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("src")
}

#[test]
fn every_background_arm_runs_under_reporting_partial() {
    let mut files = Vec::new();
    sources(&src(), &mut files);
    let mut arms = Vec::new();
    for file in &files {
        let text = fs::read_to_string(file).expect("a source file is readable");
        let relative = file.strip_prefix(src()).expect("the file is under src").to_string_lossy().into_owned();
        let count = text.matches(ARM).count();
        for (offset, _) in text.match_indices(ARM) {
            let body = text[offset + ARM.len()..].trim_start();
            assert!(
                BACKGROUND_WRAPPERS.iter().any(|wrapper| body.starts_with(wrapper)),
                "{relative}: a background arm runs outside reporting_partial: {}",
                body.lines().next().unwrap_or_default()
            );
        }
        if count > 0 {
            arms.push((relative, count));
        }
    }
    arms.sort();
    let mut expected: Vec<(String, usize)> =
        BACKGROUND_ARMS.iter().map(|&(file, count)| (file.to_owned(), count)).collect();
    expected.sort();
    assert_eq!(arms, expected, "a background entry point was added or removed: update BACKGROUND_ARMS");
}

#[test]
fn every_ax_request_entry_point_runs_under_reporting_partial() {
    for (file, name) in AX_ENTRY_POINTS {
        let text = fs::read_to_string(src().join(file)).expect("a source file is readable");
        let start = text
            .find(&format!("fn {name}("))
            .unwrap_or_else(|| panic!("{file} no longer defines {name}"));
        let end = text[start..].find("\n}\n").map_or(text.len(), |end| start + end);
        assert!(
            text[start..end].contains("reporting_partial("),
            "{file}: {name} runs outside reporting_partial"
        );
    }
}
