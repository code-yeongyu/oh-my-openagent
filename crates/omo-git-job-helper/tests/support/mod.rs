//! Test-side harness for the native contract rows (design v4.2 section 20). The test plays the writer P: it owns
//! the control pipe, drives the helper's frames and observes members only through process handles and in-frame
//! job probes. It never holds an F handle across a kill.
#![allow(
    dead_code,
    reason = "each contract-row binary uses a different subset of the harness"
)]

#[path = "../../testkit/token.rs"]
pub mod token;
#[path = "../../testkit/win.rs"]
pub mod win;

pub mod debugger;
pub mod handles;
pub mod job;
pub mod lines;
pub mod observer;
pub mod op;
pub mod owned_job;
pub mod pipe;
pub mod process;
pub mod receipt;
pub mod sddl;
pub mod timeline;

use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

pub use receipt::Receipt;

/// The helper's exit-code contract (design section 6.1 failure column).
pub const EXIT_OK: u32 = 0;
pub const EXIT_USAGE: u32 = 2;
pub const EXIT_JOB_EXISTS: u32 = 13;
pub const EXIT_VERIFY: u32 = 19;
pub const EXIT_CANCELLED: u32 = 20;
pub const EXIT_SPAWN_FAILED: u32 = 21;
pub const EXIT_PORT_FAILED: u32 = 22;
pub const LINGER_KILL_CODE: u32 = 0xC0DE_0001;

pub fn helper_exe() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_omo-git-job-helper"))
}

/// A testkit image built by cargo next to this test binary (`target/<profile>/examples`).
pub fn example(name: &str) -> PathBuf {
    let exe = std::env::current_exe().expect("test binary path");
    let profile = exe
        .parent()
        .and_then(std::path::Path::parent)
        .expect("target/<profile>");
    let path = profile.join("examples").join(format!("{name}.exe"));
    assert!(
        path.is_file(),
        "testkit image {} is missing: build the crate's examples first",
        path.display()
    );
    path
}

/// A fresh id that is a valid op id (`[A-Za-z0-9-]`) and unique across parallel rows.
pub fn unique(tag: &str) -> String {
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.subsec_nanos());
    format!(
        "{tag}-{}-{nanos}-{}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::SeqCst)
    )
}

pub fn scratch(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("omo-gjh-{}", unique(tag)));
    std::fs::create_dir_all(&dir).expect("scratch dir");
    dir
}

pub fn job_name(op: &str) -> String {
    format!("{}{op}", win::JOB_PREFIX)
}
