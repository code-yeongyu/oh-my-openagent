//! `stopPath.resume{token}` from the spawning host: the live host's latch is re-read first (a
//! set host latch refuses `Suspended{host_latch}` whatever the token), then the token must be
//! the one this session's `session.open` answered. No row builds the supervisor's lift (the
//! marker clear is the host's `hand.resume`, d-arch.md '--resume'), so a valid token leaves the
//! engine suspended and says so; the lift is an owed leg, never faked here.

use omo_computer_core::error::EngineCode;
use omo_computer_core::params::StopPathResumeParams;
use serde_json::Value;

use super::wire::WireError;
use super::Router;

pub fn resume(router: &mut Router, params: Value) -> Result<Value, WireError> {
    let StopPathResumeParams { token } =
        serde_json::from_value(params).map_err(|error| WireError::invalid_params(&error))?;
    router.admit_host_latch()?;
    if router.resume_token.as_deref() != Some(token.as_str()) {
        return Err(WireError::bare(EngineCode::PermissionDenied));
    }
    Err(WireError::bare(EngineCode::Suspended))
}
