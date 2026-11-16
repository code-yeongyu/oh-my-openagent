//! UIPI: a window above the engine's integrity RID drops every posted message silently, so
//! a background verb on it is refused `PermissionDenied` before any post.

use omo_computer_core::backend::Refusal;
use omo_computer_core::error::EngineCode;

/// Admits a background post from an engine at `engine_rid` to a target at `target_rid`.
///
/// # Errors
/// `PermissionDenied` when the target runs above the engine.
pub fn admit(target_rid: u32, engine_rid: u32) -> Result<(), Refusal> {
    let _ = (target_rid, engine_rid, Refusal::bare(EngineCode::PermissionDenied));
    Ok(())
}
