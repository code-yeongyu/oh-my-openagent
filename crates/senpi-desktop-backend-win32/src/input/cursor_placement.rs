//! Cursor placement before any `SendInput` button, drag step or wheel. A
//! pointer button or wheel reaches whatever window lies under the cursor, so
//! it may only go out once the cursor is observed on the intended physical
//! point. The decision is pure over the moves and the observations, so it is
//! tested on every host; `system::place_cursor` supplies the Win32 halves.

use senpi_desktop_core::error::{CoreResult, DesktopError};

/// Per-axis slack between the intended and the observed physical point:
/// `SendInput` normalizes absolute coordinates to 0..=65535, which can round
/// one pixel off.
pub(super) const TOLERANCE_PX: u32 = 1;

/// A way to move the cursor, in the order they are tried.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Mover {
    /// An absolute virtual-desktop move on the system input queue.
    SendInput,
    /// A direct cursor warp, when the cursor is still elsewhere after the
    /// injected move (another process clipped or moved it).
    SetCursorPos,
}

const MOVERS: [Mover; 2] = [Mover::SendInput, Mover::SetCursorPos];

pub(super) fn cursor_on(intended: (i32, i32), observed: (i32, i32)) -> bool {
    intended.0.abs_diff(observed.0) <= TOLERANCE_PX
        && intended.1.abs_diff(observed.1) <= TOLERANCE_PX
}

/// Moves the cursor to `intended` with each mover in turn until `observe`
/// reports it there, and returns the mover that placed it. A failed move or
/// observation stops at once; a cursor no mover placed is `InputFailed`, and
/// in both cases the caller sends no button or wheel.
pub(super) fn place(
    intended: (i32, i32),
    mut apply: impl FnMut(Mover) -> CoreResult<()>,
    mut observe: impl FnMut() -> CoreResult<(i32, i32)>,
) -> CoreResult<Mover> {
    let mut misses = Vec::with_capacity(MOVERS.len());
    for mover in MOVERS {
        apply(mover)?;
        let observed = observe()?;
        if cursor_on(intended, observed) {
            return Ok(mover);
        }
        misses.push(format!(
            "{mover:?} left it at ({}, {})",
            observed.0, observed.1
        ));
    }
    Err(DesktopError::input_failed(format!(
        "the cursor did not reach ({}, {}): {}; no pointer button or wheel was sent",
        intended.0,
        intended.1,
        misses.join(", ")
    )))
}

#[cfg(test)]
mod tests;
