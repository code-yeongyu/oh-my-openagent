//! What one finished canary run means for the action that ran it (#12908).

use senpi_desktop_core::error::{CoreResult, DesktopError, ErrorCode};

use super::{CanaryResult, CANARY_STOP_REASON};

/// How a finished run settles the canary state: `Some(passed)` records the
/// verdict, `None` leaves the state as it was.
pub(super) type Settle = Option<bool>;

/// The run's settlement and its reply. A run the session's press check
/// stopped because the user pressed a key or clicked in the target proved
/// nothing about the SkyLight path: it replies `UserIntervened`, as any other
/// action the user interrupts does, and leaves the canary unsettled so the
/// next background action runs it again. Every other failure is the canary's
/// own `BackgroundUnavailable` and settles it failed.
pub(super) fn verdict(delivered: CoreResult<()>, focus_restored: bool) -> (Settle, CoreResult<CanaryResult>) {
    match delivered {
        Ok(()) if focus_restored => (Some(true), Ok(CanaryResult { focus_restored: true })),
        Err(error) if error.code == ErrorCode::UserIntervened => {
            let message = format!("{CANARY_STOP_REASON}: the receipt canary was interrupted; {}", error.message);
            (None, Err(DesktopError { message, ..error }))
        }
        delivered => {
            let detail = match delivered {
                Err(error) => format!(" {error}"),
                Ok(()) => String::new(),
            };
            (
                Some(false),
                Err(DesktopError::background_unavailable(format!(
                    "{CANARY_STOP_REASON}: the background SPI path did not produce a dialog receipt or \
                     could not restore focus;{detail} retry with delivery:\"foreground\" or use ax actions",
                ))),
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use senpi_desktop_core::error::{DesktopError, ErrorCode};

    use super::{verdict, CANARY_STOP_REASON};

    const USER: &str = "the user pressed a key or clicked in Notes during this input";

    #[test]
    fn a_canary_the_user_interrupted_replies_user_intervened_and_stays_unsettled() {
        let (settle, reply) = verdict(Err(DesktopError::user_intervened(USER)), false);
        let error = reply.expect_err("an interrupted canary is not a pass");
        assert_eq!(error.code, ErrorCode::UserIntervened, "{}", error.message);
        assert_eq!(settle, None, "the user, not the SPI path, stopped the run");
    }

    #[test]
    fn a_canary_failing_for_another_reason_stays_background_unavailable() {
        let no_receipt = DesktopError::input_failed("the canary dialog reply carried no typed-marker receipt");
        let (settle, reply) = verdict(Err(no_receipt), true);
        let error = reply.expect_err("a canary without a receipt fails");
        assert_eq!(error.code, ErrorCode::BackgroundUnavailable);
        assert_eq!(settle, Some(false));

        let (settle, reply) = verdict(Ok(()), false);
        assert_eq!(reply.map_err(|error| error.code), Err(ErrorCode::BackgroundUnavailable));
        assert_eq!(settle, Some(false), "focus that did not come back fails the canary");

        assert_eq!(verdict(Ok(()), true).0, Some(true));
    }

    #[test]
    fn the_interrupted_canary_message_names_the_canary_and_the_intervention() {
        let (_, reply) = verdict(Err(DesktopError::user_intervened(USER)), true);
        let message = reply.expect_err("an interrupted canary is not a pass").message;
        assert!(message.starts_with(CANARY_STOP_REASON), "{message}");
        assert!(message.ends_with(USER), "{message}");
    }
}
