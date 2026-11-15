//! macOS retained AX objects. Every `AXUIElement` this backend hands out is a
//! registry-retained object (`AxRegistry::retain_native`): it resolves only
//! while a live ref generation holds it (or before any ref does), and once a
//! ref holds it, only while its pid still names the process that was running
//! when it was read. A dead generation or a replaced process is `StaleRef`,
//! never a surviving element.

use std::ptr::NonNull;

use objc2_application_services::{AXError, AXUIElement};
use objc2_core_foundation::CFRetained;
use senpi_desktop_core::ax::{AxHandle, AxRegistry};
use senpi_desktop_core::error::{CoreResult, DesktopError};

/// The process an element belonged to when it was read.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ProcessTag {
    pid: u32,
    started: Option<u64>,
}

struct RetainedElement {
    element: CFRetained<AXUIElement>,
    process: Option<ProcessTag>,
}

/// Wraps `element` as a retained object tagged with its process.
pub(super) fn wrap(element: CFRetained<AXUIElement>) -> AxHandle {
    let process = pid_of(&element).map(|pid| ProcessTag {
        pid,
        started: crate::input::process_started(pid),
    });
    AxRegistry::retain_native(RetainedElement { element, process })
}

/// The element behind a handle `wrap` made; `None` for any other handle.
pub(super) fn resolve(handle: &AxHandle) -> Option<CoreResult<&AXUIElement>> {
    let found = AxRegistry::retained::<RetainedElement>(handle)?;
    Some(found.and_then(|(retained, generation)| {
        if generation.is_some() {
            same_process(retained.process, crate::input::process_started)?;
        }
        Ok(&*retained.element)
    }))
}

fn pid_of(element: &AXUIElement) -> Option<u32> {
    let mut pid: libc::pid_t = 0;
    // SAFETY: `pid` is writable and the retained element outlives the call.
    let error = unsafe { element.pid(NonNull::from(&mut pid)) };
    (error == AXError::Success).then(|| u32::try_from(pid).ok()).flatten()
}

/// A ref names its element only while the element's pid still names the
/// process that was running when it was read.
fn same_process(tag: Option<ProcessTag>, started_now: impl Fn(u32) -> Option<u64>) -> CoreResult<()> {
    match tag {
        Some(ProcessTag {
            pid,
            started: Some(started),
        }) if started_now(pid) != Some(started) => Err(DesktopError::stale_ref(
            "the element's app quit or restarted; re-run ax()/find()",
        )),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use senpi_desktop_core::error::ErrorCode;

    use super::{same_process, ProcessTag};

    #[test]
    fn a_ref_resolves_only_into_the_process_it_was_read_from() {
        // Given: an element read from pid 42 started at t=100.
        let tag = Some(ProcessTag {
            pid: 42,
            started: Some(100),
        });
        // When / Then: same process ok; exited or replaced (pid reused) is stale.
        assert!(same_process(tag, |_| Some(100)).is_ok());
        assert_eq!(
            same_process(tag, |_| None).err().map(|error| error.code),
            Some(ErrorCode::StaleRef)
        );
        assert_eq!(
            same_process(tag, |_| Some(101)).err().map(|error| error.code),
            Some(ErrorCode::StaleRef)
        );
        // An element whose process could not be read is not refused for it.
        assert!(same_process(None, |_| None).is_ok());
        assert!(same_process(Some(ProcessTag { pid: 42, started: None }), |_| Some(7)).is_ok());
    }
}
