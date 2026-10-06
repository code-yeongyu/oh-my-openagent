//! The focus/cursor half of an input transaction: what is captured before
//! the action and put back after it (the model is oh-my-pi's SkyLight
//! `with_foreground` and gajae's `with_cursor_transaction`).

use senpi_desktop_core::backend::DeliveryMode;
use senpi_desktop_core::error::{CoreResult, DesktopError, ErrorCode};
use senpi_desktop_core::types::{DesktopPoint, FrontWindow};
use senpi_desktop_safety::MutatingAction;

use crate::session::guarded;
use crate::worker::Worker;

/// What a transaction captured before its action.
pub(crate) enum Guard {
    /// Background pointer or AX delivery, or an action that is itself the
    /// focus change asked for: neither the cursor nor the front window moves.
    Untouched,
    /// Foreground delivery: the front window, then the cursor, are restored.
    Foreground {
        front: Option<FrontWindow>,
        cursor: Option<DesktopPoint>,
    },
    /// Background keys: key focus is handed back to the front window (a
    /// no-op on backends that never take it).
    KeyFocus { front: Option<FrontWindow> },
}

/// A transaction's failure. A failed restore carries the error it followed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum TransactionError {
    Primary(DesktopError),
    FocusRestoreFailed {
        primary: Option<DesktopError>,
        restore: DesktopError,
    },
    CursorRestoreFailed {
        primary: Option<DesktopError>,
        restore: DesktopError,
    },
}

impl From<TransactionError> for DesktopError {
    fn from(error: TransactionError) -> Self {
        let (code, what, restore, primary) = match error {
            TransactionError::Primary(primary) => return primary,
            TransactionError::FocusRestoreFailed { primary, restore } => (
                ErrorCode::FocusRestoreFailed,
                "the previous front window",
                restore,
                primary,
            ),
            TransactionError::CursorRestoreFailed { primary, restore } => {
                (ErrorCode::CursorRestoreFailed, "the cursor", restore, primary)
            }
        };
        let message = match primary {
            Some(primary) => {
                format!("could not restore {what} ({restore}) after the action failed: {primary}")
            }
            None => format!("the action ran but {what} could not be restored: {restore}"),
        };
        Self::new(code, message)
    }
}

impl Guard {
    /// Captures what `action` delivered this way may disturb. A capture
    /// failure posts no input.
    pub(crate) fn begin(
        worker: &mut Worker,
        action: MutatingAction,
        delivery: DeliveryMode,
    ) -> CoreResult<Self> {
        let captured = |error: DesktopError| {
            DesktopError::new(
                ErrorCode::TransactionFailed,
                format!("no input was sent: the focus/cursor state could not be captured: {error}"),
            )
        };
        let guard = match (Self::kind(action), delivery) {
            (GuardKind::Untouched, _) | (GuardKind::Delivery, DeliveryMode::Background) => Self::Untouched,
            (GuardKind::Delivery | GuardKind::Keys, DeliveryMode::Foreground) => Self::Foreground {
                front: guarded(|| worker.backend()?.front_window()).map_err(captured)?,
                cursor: guarded(|| worker.backend()?.cursor_position()).map_err(captured)?,
            },
            (GuardKind::Keys, DeliveryMode::Background) => Self::KeyFocus {
                front: guarded(|| worker.backend()?.front_window()).map_err(captured)?,
            },
        };
        Ok(guard)
    }

    const fn kind(action: MutatingAction) -> GuardKind {
        match action {
            MutatingAction::RaiseWindow | MutatingAction::AxFocus => GuardKind::Untouched,
            MutatingAction::TypeText | MutatingAction::KeyChord => GuardKind::Keys,
            MutatingAction::Click
            | MutatingAction::MoveMouse
            | MutatingAction::Drag
            | MutatingAction::Scroll
            | MutatingAction::AxPerform
            | MutatingAction::AxSetValue
            | MutatingAction::AxClick
            | MutatingAction::ClipboardWrite => GuardKind::Delivery,
        }
    }

    /// Restores what [`Self::begin`] captured - the front window before the
    /// cursor - and settles the transaction's result. The second value is
    /// `focus_restored`, `None` when nothing was captured.
    pub(crate) fn restore<T>(
        self,
        worker: &mut Worker,
        result: CoreResult<T>,
    ) -> (Result<T, TransactionError>, Option<bool>) {
        let (focus, cursor) = match self {
            Self::Untouched => return (result.map_err(TransactionError::Primary), None),
            Self::Foreground { front, cursor } => (
                front.map_or(Ok(()), |front| {
                    guarded(|| worker.backend()?.restore_front_window(&front))
                }),
                cursor.map_or(Ok(()), |point| guarded(|| worker.backend()?.warp_cursor(point))),
            ),
            Self::KeyFocus { front } => (
                front.map_or(Ok(()), |front| {
                    guarded(|| worker.backend()?.restore_key_focus(&front))
                }),
                Ok(()),
            ),
        };
        let restored = focus.is_ok() && cursor.is_ok();
        let settled = match (focus, cursor) {
            (Err(restore), _) => Err(TransactionError::FocusRestoreFailed {
                primary: result.err(),
                restore,
            }),
            (Ok(()), Err(restore)) => Err(TransactionError::CursorRestoreFailed {
                primary: result.err(),
                restore,
            }),
            (Ok(()), Ok(())) => result.map_err(TransactionError::Primary),
        };
        (settled, Some(restored))
    }
}

/// Which state an action may disturb.
enum GuardKind {
    Untouched,
    /// Pointer or AX input: only foreground delivery moves focus and cursor.
    Delivery,
    /// Keyboard input: background delivery may still take key focus.
    Keys,
}

#[cfg(test)]
mod tests;
#[cfg(test)]
mod unwind_tests;
