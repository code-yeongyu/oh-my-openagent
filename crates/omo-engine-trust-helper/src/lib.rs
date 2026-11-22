//! Native fact helper for the engine CA importer (omo#10762, design sections 4.1, 4.2, 4.4 and 6.2).
//!
//! The helper reads macOS Security.framework or Windows Crypt32 in its own killable process and writes one
//! bounded JSON document of facts to stdout. It makes no trust decision: `packages/omo-native/macos-trust-helper.ts`
//! and `packages/omo-native/windows-trust-helper.ts` decode the document and
//! `packages/omo-native/engine-trust-policy.ts` decides.

pub mod document;
#[cfg(target_os = "macos")]
pub mod macos;
pub mod stdin;
pub mod watchdog;
#[cfg(target_os = "windows")]
pub mod windows;
pub mod windows_document;

/// Collects the facts and writes them to stdout; returns the process exit code.
#[cfg(target_os = "macos")]
pub fn run() -> i32 {
    watchdog::arm(
        || std::thread::sleep(watchdog::HARD_CAP),
        // _exit: never run atexit handlers while another thread may be inside Security.framework.
        || unsafe { libc::_exit(document::EXIT_WATCHDOG) },
    );
    document::emit(&macos::collect())
}

/// Reads Bun's bundled roots from stdin and writes the Crypt32 facts (design 4.2).
#[cfg(target_os = "windows")]
pub fn run() -> i32 {
    windows::run()
}

/// Linux needs no helper (design 4.3).
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn run() -> i32 {
    document::EXIT_UNSUPPORTED
}
