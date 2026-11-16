//! App resolution for `apps.open` / `apps.quit` (acceptance 84, 97): a target names an app by its
//! app key (bundle id / AUMID / `WM_CLASS` / desktop id) or by its display name; records carry
//! `source` and `identity` so consent binds to code, never to a name.

use crate::backend::Refusal;
use crate::error::{EngineCode, Reason};
use crate::listing::AppInfo;

/// No app answers to the target.
pub const APP_UNKNOWN: Refusal = Refusal::new(EngineCode::InvalidTarget, Reason::AppUnknown.wire());
/// More than one app answers to the target's display name.
pub const APP_AMBIGUOUS: Refusal = Refusal::new(EngineCode::InvalidTarget, Reason::Ambiguous.wire());

/// The app `target` names: an exact app-key match first (ASCII case-insensitive), else exactly one
/// app whose display name equals the target.
///
/// # Errors
/// [`APP_UNKNOWN`] or [`APP_AMBIGUOUS`]; nothing is launched or quit on either.
pub fn resolve<'a>(target: &str, apps: &'a [AppInfo]) -> Result<&'a AppInfo, Refusal> {
    if let Some(app) = apps.iter().find(|app| app.app_key.eq_ignore_ascii_case(target)) {
        return Ok(app);
    }
    let mut named = apps.iter().filter(|app| app.name == target);
    let app = named.next().ok_or(APP_UNKNOWN)?;
    if named.next().is_some() {
        return Err(APP_AMBIGUOUS);
    }
    Ok(app)
}
