//! Partial delivery, ported from oh-my-pi `skylight.rs` (`mark_sent`,
//! `reporting_partial`). `BackgroundUnavailable` promises that nothing was
//! sent, so the host may rerun the call in the foreground; once a background
//! call has posted input or made an AX request that may have taken effect, the
//! same refusal becomes `InputFailed`, which is never rerun blindly.

use std::cell::Cell;

use senpi_desktop_core::error::{CoreResult, DesktopError, ErrorCode};

thread_local! {
    /// Whether the background call running on this thread has sent its target
    /// anything ([`reporting_partial`]).
    static SENT: Cell<bool> = const { Cell::new(false) };
}

/// Endings of a refusal that say nothing went out or invite a rerun: neither
/// holds once input of the call was sent.
const RERUN_SUFFIXES: [&str; 5] = [
    ", so nothing was sent",
    "; nothing was sent",
    " so nothing was sent",
    ", so retry with delivery:\"foreground\" or use ax actions",
    "; retry with delivery:\"foreground\" or use ax actions",
];

/// Records that the current background call posted input to its target, or
/// made an AX request that may have taken effect there.
pub(crate) fn mark_sent() {
    SENT.set(true);
}

/// Runs one background call's `action`. A `BackgroundUnavailable` it returns
/// after it sent anything becomes `InputFailed`: the host reruns only
/// `BackgroundUnavailable` in the foreground, which would repeat input that
/// landed. A nested call's input counts for the call around it.
pub(crate) fn reporting_partial<T>(action: impl FnOnce() -> CoreResult<T>) -> CoreResult<T> {
    let outer = SENT.replace(false);
    let result = action();
    let sent = SENT.get();
    SENT.set(outer || sent);
    partial(sent, result)
}

fn partial<T>(sent: bool, result: CoreResult<T>) -> CoreResult<T> {
    match result {
        Err(error) if sent && error.code == ErrorCode::BackgroundUnavailable => {
            let reason = RERUN_SUFFIXES
                .into_iter()
                .find_map(|suffix| error.message.strip_suffix(suffix))
                .unwrap_or(&error.message);
            Err(DesktopError::input_failed(format!(
                "{reason}; earlier input of this call may already have landed, so inspect the target \
                 before retrying"
            )))
        }
        result => result,
    }
}

#[cfg(test)]
mod tests {
    use super::{mark_sent, reporting_partial};
    use senpi_desktop_core::error::{CoreResult, DesktopError, ErrorCode};

    fn refused() -> CoreResult<()> {
        Err(DesktopError::background_unavailable(
            "window 41 did not become its application's key window; nothing was sent",
        ))
    }

    #[test]
    fn a_refusal_after_the_call_posted_input_is_never_offered_for_a_rerun() {
        // Before anything went out: the host may rerun it in the foreground.
        assert_eq!(reporting_partial(refused).unwrap_err().code, ErrorCode::BackgroundUnavailable);
        // `win.type("hello")` sent "he", then the next key was refused.
        let error = reporting_partial(|| {
            mark_sent();
            refused()
        })
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::InputFailed);
        assert!(!error.message.contains("nothing was sent"), "{}", error.message);
        assert!(error.message.contains("may already have landed"), "{}", error.message);
        // A nested call's input counts for the call around it.
        let nested = reporting_partial(|| {
            reporting_partial(|| {
                mark_sent();
                Ok(())
            })?;
            refused()
        });
        assert_eq!(nested.unwrap_err().code, ErrorCode::InputFailed);
        // The next call starts unsent, and other codes pass through.
        assert_eq!(reporting_partial(refused).unwrap_err().code, ErrorCode::BackgroundUnavailable);
        let cancelled = reporting_partial(|| -> CoreResult<()> {
            mark_sent();
            Err(DesktopError::new(ErrorCode::Cancelled, "stopped"))
        });
        assert_eq!(cancelled.unwrap_err().code, ErrorCode::Cancelled);
    }

    #[test]
    fn a_partial_refusal_drops_the_rerun_advice() {
        let error = reporting_partial(|| -> CoreResult<()> {
            mark_sent();
            Err(DesktopError::background_unavailable(
                "window 7 is one of 2 windows in its application, so retry with \
                 delivery:\"foreground\" or use ax actions",
            ))
        })
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::InputFailed);
        assert!(!error.message.contains("retry with delivery"), "{}", error.message);
        assert!(error.message.starts_with("window 7 is one of 2 windows"), "{}", error.message);
    }

    #[test]
    fn an_outer_call_keeps_its_own_earlier_input_across_a_nested_call() {
        let error = reporting_partial(|| {
            mark_sent();
            reporting_partial(|| Ok(()))?;
            refused()
        })
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::InputFailed);
    }
}
