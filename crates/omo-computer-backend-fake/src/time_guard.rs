//! The source guard.

pub const FORBIDDEN: &[&str] = &[];

#[derive(Debug, Default)]
pub struct GuardReport {
    pub files_scanned: usize,
    pub findings: Vec<String>,
}

pub fn scan_crate_sources() -> GuardReport {
    GuardReport::default()
}

pub fn scan_text(file: &str, text: &str) -> Vec<String> {
    let _ = (file, text);
    Vec::new()
}
