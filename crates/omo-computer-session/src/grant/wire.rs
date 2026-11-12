//! The host-only grant verbs over the wire, as an interim dispatch (R31): `Session::host_call`
//! answers a method of row 12's method table that a row-21-to-27 session module serves, with
//! typed params; any other method is `None` and the engine answers it as before. Row 28 moves
//! this routing into the engine router.

use omo_computer_core::methods::Method;
use omo_computer_core::params::{ControlGrantParams, EmptyParams};
use serde::de::DeserializeOwned;
use serde_json::{json, Value};

use crate::mutate::Refused;
use crate::Session;

/// Why a host call did not answer a result.
#[derive(Debug)]
pub enum HostCallError {
    /// The params do not fit the method's typed params.
    Params(serde_json::Error),
    Refused(Refused),
}

pub(crate) fn typed<T: DeserializeOwned>(params: Value) -> Result<T, HostCallError> {
    serde_json::from_value(params).map_err(HostCallError::Params)
}

impl Session {
    /// One host call this session's rows serve, or `None` for any other method.
    pub fn host_call(&mut self, method: Method, params: Value) -> Option<Result<Value, HostCallError>> {
        let outcome = match method {
            Method::ControlGrant => typed::<ControlGrantParams>(params).map(|p| json!(self.control_grant(p))),
            Method::ControlAcquire => typed::<EmptyParams>(params).and_then(|_| {
                self.control_acquire().map(|state| json!(state)).map_err(HostCallError::Refused)
            }),
            Method::ControlRevoke => typed::<EmptyParams>(params).map(|_| {
                self.control_revoke();
                Value::Null
            }),
            Method::ControlRelease => typed::<EmptyParams>(params).map(|_| {
                self.control_release();
                Value::Null
            }),
            Method::DisplayRelease => typed::<EmptyParams>(params).map(|_| {
                self.display_release();
                Value::Null
            }),
            Method::DisplayResume => typed::<EmptyParams>(params).map(|_| {
                self.display_resume();
                Value::Null
            }),
            Method::PreviewSubscribe => typed::<EmptyParams>(params).map(|_| {
                self.preview_subscribe();
                Value::Null
            }),
            _ => return self.row23_call(method, params),
        };
        Some(outcome)
    }
}
