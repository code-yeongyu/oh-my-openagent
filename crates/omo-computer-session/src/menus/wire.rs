//! Row 25's methods over the wire, chained from `Session::host_call` (R31): `menu.items`,
//! `menu.select`, `apps.list` / `open` / `quit`, `surface` and `openSystemSurface`, each with
//! the typed params of row 12's method table. Any other method is `None`.

use omo_computer_core::methods::Method;
use omo_computer_core::params::{EmptyParams, OpenSystemSurfaceParams, SurfaceParams};
use serde_json::{json, Value};

use crate::grant::HostCallError;
use crate::mutate::Refused;
use crate::Session;

fn typed<T: serde::de::DeserializeOwned>(params: Value) -> Result<T, HostCallError> {
    serde_json::from_value(params).map_err(HostCallError::Params)
}

fn refused<T: serde::Serialize>(result: Result<T, Refused>) -> Result<Value, HostCallError> {
    result.map(|value| json!(value)).map_err(HostCallError::Refused)
}

pub(crate) fn host_call(session: &mut Session, method: Method, params: Value) -> Option<Result<Value, HostCallError>> {
    let outcome = match method {
        Method::MenuItems => typed(params).and_then(|p| refused(session.menu_items(p))),
        Method::MenuSelect => typed(params).and_then(|p| refused(session.menu_select(p))),
        Method::AppsList => typed::<EmptyParams>(params).and_then(|_| refused(session.apps_list().map_err(Refused::from))),
        Method::AppsOpen => typed(params).and_then(|p| refused(session.apps_open(p))),
        Method::AppsQuit => typed(params).and_then(|p| refused(session.apps_quit(p))),
        Method::Surface => typed::<SurfaceParams>(params).and_then(|p| refused(session.surface(p.kind))),
        Method::OpenSystemSurface => {
            typed::<OpenSystemSurfaceParams>(params).and_then(|p| refused(session.open_system_surface(p.kind)))
        }
        _ => return crate::diagnose_wire::host_call(session, method, params),
    };
    Some(outcome)
}
