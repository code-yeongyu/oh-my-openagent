//! The source guard behind `fake_clock_is_the_only_time_source`: no file of this crate reads
//! the host's clock or waits. Each needle is split so this file does not match itself.

use std::path::{Path, PathBuf};

pub const FORBIDDEN: &[&str] = &[
    concat!("Inst", "ant"),
    concat!("System", "Time"),
    concat!("UNIX", "_EPOCH"),
    concat!("sle", "ep("),
    concat!("tokio", "::time"),
    concat!("chr", "ono::"),
];

#[derive(Debug, Default)]
pub struct GuardReport {
    pub files_scanned: usize,
    pub findings: Vec<String>,
}

/// One finding per forbidden needle per line.
#[must_use]
pub fn scan_text(file: &str, text: &str) -> Vec<String> {
    text.lines()
        .enumerate()
        .flat_map(|(index, line)| {
            FORBIDDEN
                .iter()
                .filter(move |needle| line.contains(*needle))
                .map(move |needle| format!("{file}:{}: {needle}", index + 1))
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
