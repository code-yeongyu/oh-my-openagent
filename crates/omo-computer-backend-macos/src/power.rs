//! The macOS mechanism of the session-scoped `DisplayAwakeHold` (row 22): one
//! `IOPMAssertion` (`PreventUserIdleDisplaySleep`) held exactly while the session's hold is
//! `held`, released when it lapses, is released or capped, and when the session closes.

use omo_computer_core::capabilities::DisplayAwakeMechanism;

/// The assertion calls.
pub trait PowerOs: Send {
    /// `IOPMAssertionCreateWithName`; `None` when the OS refused.
    fn assert_display_awake(&mut self, name: &str) -> Option<u32>;
    /// `IOPMAssertionRelease`.
    fn release(&mut self, id: u32);
}

/// The assertion name the OS shows in `pmset -g assertions`.
pub const ASSERTION_NAME: &str = "OmO Computer Use is acting";

/// The display-awake assertion of one session.
pub struct DisplayAwakePower<P: PowerOs> {
    os: P,
    held: Option<u32>,
}

impl<P: PowerOs> DisplayAwakePower<P> {
    pub const MECHANISM: DisplayAwakeMechanism = DisplayAwakeMechanism::IopmAssertion;

    pub const fn new(os: P) -> Self {
        Self { os, held: None }
    }

    pub const fn os(&self) -> &P {
        &self.os
    }

    /// Follows the session's hold: `held` true takes the one assertion (once), false releases
    /// it. Answers whether an assertion is held now.
    pub fn sync(&mut self, held: bool) -> bool {
        match (held, self.held) {
            (true, None) => self.held = self.os.assert_display_awake(ASSERTION_NAME),
            (false, Some(id)) => {
                self.os.release(id);
                self.held = None;
            }
            _ => {}
        }
        self.held.is_some()
    }
}

impl<P: PowerOs> Drop for DisplayAwakePower<P> {
    fn drop(&mut self) {
        if let Some(id) = self.held.take() {
            self.os.release(id);
        }
    }
}

#[cfg(target_os = "macos")]
pub mod os {
    //! `IOPMAssertionCreateWithName(PreventUserIdleDisplaySleep)` and its release.

    use std::ffi::CString;

    use super::PowerOs;
    use crate::capture::os::cf::{cf_string, CfRef};

    const LEVEL_ON: u32 = 255;
    const SUCCESS: i32 = 0;

    #[link(name = "IOKit", kind = "framework")]
    unsafe extern "C" {
        fn IOPMAssertionCreateWithName(kind: CfRef, level: u32, name: CfRef, id: *mut u32) -> i32;
        fn IOPMAssertionRelease(id: u32) -> i32;
    }

    /// The live assertion calls.
    #[derive(Debug, Default)]
    pub struct Os;

    impl PowerOs for Os {
        fn assert_display_awake(&mut self, name: &str) -> Option<u32> {
            let kind = cf_string(c"PreventUserIdleDisplaySleep")?;
            let name = cf_string(&CString::new(name).ok()?)?;
            let mut id = 0u32;
            // SAFETY: valid CFStrings and an out id.
            (unsafe { IOPMAssertionCreateWithName(kind.get(), LEVEL_ON, name.get(), &raw mut id) }
                == SUCCESS)
                .then_some(id)
        }

        fn release(&mut self, id: u32) {
            // SAFETY: an id this process created.
            unsafe { IOPMAssertionRelease(id) };
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::{DisplayAwakePower, PowerOs};

    #[derive(Clone, Default)]
    struct Ledger(Arc<Mutex<Vec<String>>>);

    struct FakePower {
        ledger: Ledger,
        next: u32,
        refuse: bool,
    }

    impl PowerOs for FakePower {
        fn assert_display_awake(&mut self, name: &str) -> Option<u32> {
            if self.refuse {
                return None;
            }
            self.next += 1;
            self.ledger
                .0
                .lock()
                .expect("ledger")
                .push(format!("create {} {name}", self.next));
            Some(self.next)
        }

        fn release(&mut self, id: u32) {
            self.ledger
                .0
                .lock()
                .expect("ledger")
                .push(format!("release {id}"));
        }
    }

    #[test]
    fn display_awake_hold_is_session_scoped_and_reports_its_mechanism() {
        let ledger = Ledger::default();
        let mut power = DisplayAwakePower::new(FakePower {
            ledger: ledger.clone(),
            next: 0,
            refuse: false,
        });
        assert_eq!(
            serde_json::to_value(DisplayAwakePower::<FakePower>::MECHANISM).ok(),
            Some("IOPMAssertion".into())
        );
        assert!(power.sync(true));
        assert!(
            power.sync(true),
            "refreshed by activity, still one assertion"
        );
        assert!(!power.sync(false), "lapsed, released or capped");
        assert!(power.sync(true));
        drop(power);
        let lines = ledger.0.lock().expect("ledger").clone();
        assert_eq!(lines.iter().filter(|l| l.starts_with("create")).count(), 2);
        assert_eq!(
            lines.last().map(String::as_str),
            Some("release 2"),
            "session close releases"
        );
        assert_eq!(lines.iter().filter(|l| l.starts_with("release")).count(), 2);
    }

    #[test]
    fn a_refused_assertion_is_not_reported_held() {
        let mut power = DisplayAwakePower::new(FakePower {
            ledger: Ledger::default(),
            next: 0,
            refuse: true,
        });
        assert!(!power.sync(true));
    }
}
