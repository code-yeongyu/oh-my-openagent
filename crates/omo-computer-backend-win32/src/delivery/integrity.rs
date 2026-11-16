//! UIPI: a window above the engine's integrity RID drops posted input (design/d-windows.md:151;
//! the ledger row win32-delivery:n-uipi-postmessage is NOT-RUN on the hosted runner, owed to
//! #13885), so a background verb on it is refused `PermissionDenied` before any post. A token
//! that cannot be read counts as above (fail closed).

use omo_computer_core::backend::Refusal;
use omo_computer_core::error::EngineCode;

/// The integrity read of a target window and of the engine.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Integrity {
    Rids { target: u32, engine: u32 },
    Unreadable,
}

/// The refusal of a target above the engine.
pub const ABOVE_ENGINE: Refusal = Refusal::bare(EngineCode::PermissionDenied);

/// Admits a background post from an engine at `engine_rid` to a target at `target_rid`.
///
/// # Errors
/// `PermissionDenied` when the target runs above the engine.
pub const fn admit(target_rid: u32, engine_rid: u32) -> Result<(), Refusal> {
    if target_rid > engine_rid {
        Err(ABOVE_ENGINE)
    } else {
        Ok(())
    }
}

/// Admits a post after an [`Integrity`] read.
///
/// # Errors
/// `PermissionDenied` when the target is above the engine or either token cannot be read.
pub const fn admit_read(read: Integrity) -> Result<(), Refusal> {
    match read {
        Integrity::Rids { target, engine } => admit(target, engine),
        Integrity::Unreadable => Err(ABOVE_ENGINE),
    }
}
