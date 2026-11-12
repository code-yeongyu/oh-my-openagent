//! Row 23's methods on the interim host-call route (R31): `Session::host_call` chains here
//! for every method it does not serve itself.

use omo_computer_core::methods::Method;
use omo_computer_core::params::{
    DragParams, EmptyParams, HoldKeysParams, HoldMouseParams, KeyDownParams, KeyUpParams, MouseDownParams, MouseUpParams,
    MoveParams, ScrollParams,
};
use serde_json::{json, Value};

use crate::grant::HostCallError;
use crate::mutate::Refused;
use crate::Session;

fn exec<P: serde::de::DeserializeOwned>(
    session: &mut Session,
    params: Value,
    verb: fn(&mut Session, P) -> Result<omo_computer_core::results::ExecReply, Refused>,
) -> Result<Value, HostCallError> {
    let params = serde_json::from_value(params).map_err(HostCallError::Params)?;
    verb(session, params).map(|reply| json!(reply)).map_err(HostCallError::Refused)
}

impl Session {
    /// One of row 23's methods, or `None` for any other.
    pub(crate) fn row23_call(&mut self, method: Method, params: Value) -> Option<Result<Value, HostCallError>> {
        Some(match method {
            Method::Move => exec::<MoveParams>(self, params, Self::move_pointer),
            Method::MouseDown => exec::<MouseDownParams>(self, params, Self::mouse_down),
            Method::MouseUp => exec::<MouseUpParams>(self, params, Self::mouse_up),
            Method::KeyDown => exec::<KeyDownParams>(self, params, Self::key_down),
            Method::KeyUp => exec::<KeyUpParams>(self, params, Self::key_up),
            Method::Drag => exec::<DragParams>(self, params, Self::drag),
            Method::Scroll => exec::<ScrollParams>(self, params, Self::scroll),
            Method::HoldKeys => exec::<HoldKeysParams>(self, params, Self::hold_keys),
            Method::HoldMouse => exec::<HoldMouseParams>(self, params, Self::hold_mouse),
            Method::Pointer => serde_json::from_value::<EmptyParams>(params)
                .map_err(HostCallError::Params)
                .and_then(|_| self.pointer().map(|p| json!(p)).map_err(|r| HostCallError::Refused(Refused::from(r)))),
            _ => return None,
        })
    }
}
