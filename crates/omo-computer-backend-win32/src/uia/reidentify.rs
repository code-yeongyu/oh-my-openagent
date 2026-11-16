//! Ref re-identification by `RuntimeId` (d-windows.md '## UI Automation', Identity and refs):
//! exactly one live element acts; 0 is `StaleRef`, 2 or more `AmbiguousTarget`.

use omo_computer_core::backend::Refusal;
use omo_computer_core::error::EngineCode;

use super::element::UiaElement;

/// The one element `found` names.
///
/// # Errors
/// `StaleRef` for none, `AmbiguousTarget` for two or more.
pub fn reidentify(mut found: Vec<UiaElement>) -> Result<UiaElement, Refusal> {
    match found.len() {
        0 => Err(Refusal::bare(EngineCode::StaleRef)),
        1 => found.pop().ok_or_else(|| Refusal::bare(EngineCode::StaleRef)),
        _ => Ok(found.swap_remove(0)),
    }
}
