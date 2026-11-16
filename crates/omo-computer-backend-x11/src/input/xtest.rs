//! XTEST input is foreground input: it lands wherever the server's focus is, so it is sent only
//! while this session holds the foreground lease (d-linux.md 'XTEST input').

use omo_computer_core::backend::Refusal;
use omo_computer_core::error::{EngineCode, Reason};

/// Whether an XTEST send may go out.
///
/// # Errors
/// `ControlRequired{lease_missing}` with nothing sent when no lease is held.
pub fn admit(lease_held: bool) -> Result<(), Refusal> {
    if lease_held {
        Ok(())
    } else {
        Err(Refusal::new(EngineCode::ControlRequired, Reason::LeaseMissing))
    }
}
