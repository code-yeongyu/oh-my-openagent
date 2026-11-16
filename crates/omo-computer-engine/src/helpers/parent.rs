//! A helper's watch on the process that started it (d-arch.md 'Crash isolation': the parent
//! pid re-checked at <= 500 ms). A parent that dies is replaced by an adopter (init or a
//! subreaper), so a change of `getppid` is the death, whatever killed it.

use std::time::Duration;

/// How often the parent pid is re-read; the design's ceiling is 500 ms.
const POLL: Duration = Duration::from_millis(200);

pub struct ParentWatch {
    parent: u32,
}

impl ParentWatch {
    #[must_use]
    pub fn new() -> Self {
        Self { parent: parent_id() }
    }

    #[must_use]
    pub fn parent_alive(&self) -> bool {
        self.parent > 1 && parent_id() == self.parent
    }

    /// Blocks until the parent is gone.
    pub fn wait_for_death(&self) {
        while self.parent_alive() {
            std::thread::sleep(POLL);
        }
    }
}

#[cfg(unix)]
fn parent_id() -> u32 {
    std::os::unix::process::parent_id()
}

/// Windows contains its helpers in the engine's Job Object instead (row 57/60, owed).
#[cfg(not(unix))]
const fn parent_id() -> u32 {
    2
}
