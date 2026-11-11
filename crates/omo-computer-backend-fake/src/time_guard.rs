//! The source guard behind `fake_clock_is_the_only_time_source` and
//! `the_fake_reads_no_environment`: no file of this crate reads the host's clock, waits, or
//! reads the environment (seams arrive as values). Each needle is split so this file does not
//! match itself.

use std::path::{Path, PathBuf};

pub const FORBIDDEN: &[&str] = &[
    concat!("Inst", "ant"),
    concat!("System", "Time"),
    concat!("UNIX", "_EPOCH"),
    concat!("sle", "ep("),
    concat!("tokio", "::time"),
    concat!("chr", "ono::"),
    concat!("std", "::env"),
    concat!("env", "::"),
];

/// The module a grouped `use` may name without spelling its crate path.
const ENV_MODULE: &str = concat!("e", "nv");

/// The opening of a grouped `std` import, split so this file does not match itself.
const STD_GROUP: &str = concat!("std::", "{");

#[derive(Debug, Default)]
pub struct GuardReport {
    pub files_scanned: usize,
    pub findings: Vec<String>,
}

/// Whether `needle` occurs in `line` not as the tail of a longer identifier.
fn contains_word(line: &str, needle: &str) -> bool {
    line.match_indices(needle).any(|(at, _)| {
        line[..at]
            .chars()
            .next_back()
            .is_none_or(|before| !(before.is_alphanumeric() || before == '_'))
    })
}

/// The top-level items of every grouped `std` import in `line`.
fn grouped_std_items(line: &str) -> Vec<String> {
    let mut items = Vec::new();
    for (at, _) in line.match_indices(STD_GROUP) {
        let (mut depth, mut item) = (0_u32, String::new());
        for ch in line[at + STD_GROUP.len()..].chars() {
            match ch {
                '{' => depth += 1,
                '}' if depth == 0 => break,
                '}' => depth -= 1,
                ',' if depth == 0 => items.push(std::mem::take(&mut item)),
                _ if depth == 0 => item.push(ch),
                _ => {}
            }
        }
        items.push(item);
    }
    items
}

/// Whether a grouped import names the environment module: bare, renamed with `as`, or
/// followed by a path into it.
fn imports_env_module(line: &str) -> bool {
    grouped_std_items(line).iter().any(|item| {
        let item = item.trim();
        item == ENV_MODULE
            || item
                .strip_prefix(ENV_MODULE)
                .is_some_and(|rest| rest.starts_with(' ') || rest.starts_with(':'))
    })
}

/// One finding per forbidden needle per line, plus one per grouped import of the
/// environment module.
#[must_use]
pub fn scan_text(file: &str, text: &str) -> Vec<String> {
    text.lines()
        .enumerate()
        .flat_map(|(index, line)| {
            let needles = FORBIDDEN
                .iter()
                .filter(move |needle| contains_word(line, needle))
                .map(move |needle| format!("{file}:{}: {needle}", index + 1));
            let grouped = imports_env_module(line).then(|| {
                format!(
                    "{file}:{}: grouped import of the {ENV_MODULE} module",
                    index + 1
                )
            });
            needles.chain(grouped)
        })
        .collect()
}

fn rust_files(dir: &Path, out: &mut Vec<PathBuf>, findings: &mut Vec<String>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) => {
            findings.push(format!("{}: unreadable: {error}", dir.display()));
            return;
        }
    };
    for path in entries.filter_map(Result::ok).map(|entry| entry.path()) {
        if path.is_dir() {
            rust_files(&path, out, findings);
        } else if path.extension().is_some_and(|ext| ext == "rs") {
            out.push(path);
        }
    }
}

/// Scans every `.rs` file under this crate's `src/`.
#[must_use]
pub fn scan_crate_sources() -> GuardReport {
    let mut report = GuardReport::default();
    let mut files = Vec::new();
    rust_files(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("src"),
        &mut files,
        &mut report.findings,
    );
    files.sort();
    for path in files {
        match std::fs::read_to_string(&path) {
            Ok(text) => {
                report.files_scanned += 1;
                report
                    .findings
                    .extend(scan_text(&path.display().to_string(), &text));
            }
            Err(error) => report
                .findings
                .push(format!("{}: unreadable: {error}", path.display())),
        }
    }
    report
}
