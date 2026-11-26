//! Row 24's methods on the interim host-call route (R50, R56): chained after row 23's.

use omo_computer_core::methods::Method;
use omo_computer_core::params::{AxPerformParams, AxRefParams, AxSetValueParams, WindowFrameParams, WindowParams};
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
    /// One of row 24's methods, or `None` for any other.
    pub(crate) fn row24_call(&mut self, method: Method, params: Value) -> Option<Result<Value, HostCallError>> {
        Some(match method {
            Method::AxSetValue => exec::<AxSetValueParams>(self, params, Self::ax_set_value),
            Method::AxFocus => exec::<AxRefParams>(self, params, Self::ax_focus),
            Method::AxPerform => exec::<AxPerformParams>(self, params, Self::ax_perform),
            Method::WindowSetFrame => exec::<WindowFrameParams>(self, params, Self::window_set_frame),
            Method::WindowMinimize => exec::<WindowParams>(self, params, Self::window_minimize),
            Method::WindowRestore => exec::<WindowParams>(self, params, Self::window_restore),
            Method::ClipboardRead => serde_json::from_value::<omo_computer_core::params::EmptyParams>(params)
                .map_err(HostCallError::Params)
                .and_then(|_| self.clipboard_read().map_err(HostCallError::Refused)),
            Method::ClipboardWrite => exec::<omo_computer_core::params::ClipboardWriteParams>(self, params, Self::clipboard_write),
            Method::Paste => exec::<omo_computer_core::params::PasteParams>(self, params, Self::paste),
            Method::Press => exec::<omo_computer_core::params::PressParams>(self, params, Self::press),
            Method::KeyChord => exec::<omo_computer_core::params::KeyChordParams>(self, params, Self::key_chord),
            Method::AxTypeText => serde_json::from_value::<omo_computer_core::params::AxTypeTextParams>(params)
                .map_err(HostCallError::Params)
                .and_then(|p| self.ax_type_text(p).map(|r| json!(r)).map_err(HostCallError::Refused)),
            Method::AxSelectText => exec::<omo_computer_core::params::SelectTextParams>(self, params, Self::ax_select_text),
            Method::AxSnapshot => serde_json::from_value(params)
                .map_err(HostCallError::Params)
                .and_then(|p| self.ax_snapshot(p).map(|s| json!(s)).map_err(HostCallError::Refused)),
            _ => return None,
        })
    }
}
