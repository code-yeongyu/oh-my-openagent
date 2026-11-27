use crate::connection::TransportError;

/// Fail before activation; neither named nor anonymous listeners can bypass it.
pub(crate) fn prepare_listener(
    requirement: impl FnOnce() -> i32,
    handler: impl FnOnce(),
    resume: impl FnOnce(),
) -> Result<(), TransportError> {
    let status = requirement();
    if status != 0 {
        return Err(TransportError::Requirement(status));
    }
    handler();
    resume();
    Ok(())
}
