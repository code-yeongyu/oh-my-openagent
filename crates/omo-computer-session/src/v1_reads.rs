//! The v1 `windows` read and `raiseWindow` the imported corpus calls and no earlier row serves (plan row 28: "a v1
//! name that no earlier row serves gets its thin adapter in this row, never a second code path"):
//! the backend's one listing, shaped by the open session's report mode.

use omo_computer_core::backend::{Refusal, Route, WindowFilter};
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::listing::WindowInfo;
use omo_computer_core::methods::Method;
use omo_computer_core::params::{RaiseWindowParams, ReportMode, WindowsParams};
use omo_computer_core::requests::CallAuthority;
use omo_computer_core::results::{ExecReply, LegacyWindow, WindowsReply};
use omo_computer_safety::{Call, TargetRef, VerbKind};

use crate::mutate::{Mutation, Refused};
use crate::Session;

impl Session {
    /// `windows{app?, title?, pid?}`.
    ///
    /// # Errors
    /// The backend's refusal of the listing.
    pub fn windows(&mut self, params: WindowsParams) -> Result<WindowsReply, Refusal> {
        let filter = WindowFilter {
            app: params.app,
            title: params.title,
            pid: params.pid,
        };
        let list = self.backend.windows(&filter)?.windows;
        Ok(match self.opened.as_ref().map(|opened| opened.report_mode) {
            Some(ReportMode::Object) => WindowsReply::Object(list),
            Some(ReportMode::Null) | None => WindowsReply::Legacy(list.iter().map(legacy).collect()),
        })
    }

    /// `raiseWindow{windowId}`: a foreground act no row builds yet (lead decision 3, row 28). It
    /// runs every gate (stop path, consent, lease) and audits like any exec, then refuses
    /// `ControlRequired{lease_missing}` with its next call; nothing is sent. Row 21 owes the verb.
    ///
    /// # Errors
    /// The first gate's refusal, else `ControlRequired{lease_missing}`.
    pub fn raise_window(&mut self, params: RaiseWindowParams) -> Result<ExecReply, Refused> {
        let dispatched = serde_json::to_value(&params).unwrap_or_default();
        let RaiseWindowParams { window_id } = params;
        let call = Call {
            verb: VerbKind::Keyboard,
            target: TargetRef::read(Some(window_id.as_str())),
            points: Vec::new(),
            chord: None,
            force: false,
        };
        let needs_lease = Refusal::new(EngineCode::ControlRequired, Reason::LeaseMissing);
        let mutation = Mutation::exec(Method::RaiseWindow, call, Vec::new(), Route::ForegroundHid, &CallAuthority::default())
            .refused_after_gates(needs_lease);
        self.traced(dispatched, &window_id, mutation)
    }
}

/// v1 wrote whole points; a coordinate past the integer range saturates (an off-screen window).
#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "f64-to-integer `as` saturates and maps NaN to 0, which is the wanted rounding of a point"
)]
fn legacy(window: &WindowInfo) -> LegacyWindow {
    let bounds = &window.bounds;
    LegacyWindow {
        id: window.id.clone(),
        title: window.title.clone(),
        app: window.app.clone(),
        pid: window.identity.pid,
        x: bounds.x.round() as i32,
        y: bounds.y.round() as i32,
        width: bounds.width.round().max(0.0) as u32,
        height: bounds.height.round().max(0.0) as u32,
        focused: window.focused,
        elevated: window.elevated.then_some(true),
    }
}

#[cfg(test)]
mod tests {
    use omo_computer_backend_fake::FakeBackend;
    use serde_json::json;

    use super::*;

    const TWO: &str = r#"{"windows":[{"id":"101","title":"Notes","app":"Notes","pid":4242,"x":100,"y":120,"width":800,"height":600,"focused":true,"elevated":null},{"id":"102","title":"log","app":"Terminal","pid":5151,"x":980,"y":120,"width":800,"height":600,"focused":false,"elevated":null}]}"#;

    #[test]
    fn the_v1_listing_keeps_its_record_shape_and_honours_the_filter() {
        let mut session = Session::new(Box::new(FakeBackend::from_json(TWO).expect("scenario")));
        let all = session.windows(serde_json::from_value(json!({})).expect("params")).expect("listed");
        assert_eq!(
            serde_json::to_value(&all).expect("json")[0],
            json!({"id": "101", "title": "Notes", "app": "Notes", "pid": 4242, "x": 100, "y": 120, "width": 800, "height": 600, "focused": true, "elevated": null})
        );
        let terminal = session.windows(serde_json::from_value(json!({"app": "Terminal"})).expect("params")).expect("listed");
        assert_eq!(serde_json::to_value(&terminal).expect("json").as_array().map(Vec::len), Some(1));
    }
}
