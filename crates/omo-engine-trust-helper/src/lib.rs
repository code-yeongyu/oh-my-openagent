//! Native fact helper for the engine CA importer (omo#10762, design sections 4.1, 4.2 and 6.2).
//!
//! The helper reads Windows Crypt32 in its own killable process and writes one bounded JSON document of
//! facts to stdout. It makes no trust decision: `packages/omo-native/windows-trust-helper.ts` decodes the
//! document and `packages/omo-native/engine-trust-policy.ts` decides.

pub mod document;
pub mod stdin;
pub mod watchdog;
#[cfg(target_os = "windows")]
pub mod windows;
pub mod windows_document;

/// Reads Bun's bundled roots from stdin and writes the Crypt32 facts (design 4.2).
#[cfg(target_os = "windows")]
pub fn run() -> i32 {
    windows::run()
}

/// The macOS helper is a separate change; Linux needs no helper (design 4.3).
#[cfg(not(target_os = "windows"))]
pub fn run() -> i32 {
    document::EXIT_UNSUPPORTED
}
