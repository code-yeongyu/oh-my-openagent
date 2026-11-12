//! Row 27: the session's toolkit route table and the per-OS route ladder (acceptance 75, 95;
//! design rows C16, C19). At `session.open` the shipped seed is loaded and extended by the
//! user's `computer.toolkit_routes`; a table that fails its load test refuses the open with
//! `Unavailable{route_table_invalid, pointer}` instead of starting on a partial table. The ladder
//! is a declared order per OS: one route per call, a refused first leg never improvises another.

use omo_computer_core::backend::Refusal;
use omo_computer_core::capabilities::RouteRung;
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::requests::SessionOpenRequest;
use omo_computer_core::routes::{RouteOs, RouteTable, RouteTableInvalid};
use serde_json::json;

/// The refusal of a table that failed its load test.
pub const ROUTE_TABLE_INVALID: Refusal =
    Refusal::new(EngineCode::Internal, Reason::RouteTableInvalid.wire());

/// The OS family this engine routes for.
#[must_use]
pub const fn host_os() -> RouteOs {
    if cfg!(target_os = "macos") {
        RouteOs::Macos
    } else if cfg!(target_os = "windows") {
        RouteOs::Windows
    } else {
        RouteOs::X11
    }
}

/// `capabilities().routeLadder` for `os`: physical first except where the semantic route is
/// first (the Windows posted-click -> UIA-invoke fallback for drop-predicted classes).
#[must_use]
pub fn route_ladder(os: RouteOs, drop_predicted: bool) -> Vec<RouteRung> {
    match (os, drop_predicted) {
        (RouteOs::Windows, true) => vec![RouteRung::Semantic, RouteRung::Physical],
        _ => vec![RouteRung::Physical, RouteRung::Semantic],
    }
}

/// The table a session opens with: the seed, extended by the user's exact keys.
///
/// # Errors
/// [`ROUTE_TABLE_INVALID`] carrying `data.pointer` (R28, R52); the session stays unopened.
pub fn open_routes(request: &SessionOpenRequest, os: RouteOs) -> Result<RouteTable, Refusal> {
    let refuse = |invalid: RouteTableInvalid| ROUTE_TABLE_INVALID.with_data(json!({ "pointer": invalid.pointer }));
    let mut table = RouteTable::seed().map_err(refuse)?;
    if let Some(user) = request.config.as_ref().and_then(|config| config.consent.toolkit_routes.as_ref()) {
        table.extend(os, user).map_err(refuse)?;
    }
    Ok(table)
}

#[cfg(test)]
mod tests {
    use omo_computer_core::settings::ToolkitClass;

    use super::*;

    #[test]
    fn the_ladder_is_a_declared_order_per_os() {
        assert_eq!(route_ladder(RouteOs::Macos, false), [RouteRung::Physical, RouteRung::Semantic]);
        assert_eq!(route_ladder(RouteOs::X11, true), [RouteRung::Physical, RouteRung::Semantic]);
        assert_eq!(route_ladder(RouteOs::Windows, true), [RouteRung::Semantic, RouteRung::Physical]);
        assert_eq!(route_ladder(RouteOs::Windows, false), [RouteRung::Physical, RouteRung::Semantic]);
    }

    #[test]
    fn route_table_invalid_refuses_the_open_with_its_pointer() {
        let mut request = omo_computer_core::requests::read_session_open(serde_json::from_value(json!({})).expect("params"));
        let config = request.config.get_or_insert_with(Default::default);
        config.consent.toolkit_routes = Some([("Blend*".to_owned(), ToolkitClass::CanvasGl)].into());
        let refusal = open_routes(&request, RouteOs::X11).expect_err("a pattern key");
        assert_eq!((refusal.code, refusal.reason), (EngineCode::Internal, Some("route_table_invalid")));
        assert_eq!(refusal.wire_data()["pointer"], json!("/toolkit_routes/Blend*"));
        assert_eq!(refusal.computer_code().map(|c| c.wire()), Ok("COMPUTER_UNAVAILABLE"));
    }
}
