use std::time::Duration;

use senpi_desktop_core::ax::{AxBackend, AxHandle, AxObserved, AxOwner, AxProps};
use senpi_desktop_core::error::CoreResult;
use senpi_desktop_core::types::{AxEvidence, DesktopWindow, EvidenceState};

use crate::ax_tree::node_id;
use crate::fake::FakeBackend;
use crate::method::{AxWrite, FakeMethod};
use crate::sink::SinkOp;

impl AxBackend for FakeBackend {
    fn window_root(&mut self, win: &DesktopWindow) -> CoreResult<AxHandle> {
        self.begin(FakeMethod::AxWindowRoot)?;
        self.ax_tree.root(&win.id).map(AxHandle::Id)
    }

    fn props(&mut self, h: &AxHandle) -> CoreResult<AxProps> {
        self.begin(FakeMethod::AxProps)?;
        self.ax_tree.props(node_id(h)?)
    }

    /// A scripted `ax_deadline_ms` is how long reading a window root's
    /// children takes, so a walk whose deadline is at most that long runs out
    /// right after the root.
    fn children(&mut self, h: &AxHandle) -> CoreResult<Vec<AxHandle>> {
        self.begin(FakeMethod::AxChildren)?;
        let node = node_id(h)?;
        if let Some(stall) = self
            .ax_deadline_ms()
            .filter(|_| matches!(self.ax_tree.parent(node), Ok(None)))
        {
            std::thread::sleep(Duration::from_millis(stall));
        }
        let children = self.ax_tree.children(node)?;
        Ok(children.into_iter().map(AxHandle::Id).collect())
    }

    /// Evidence as the scripted data says: a field present is known, missing
    /// absent. A scripted `ax_attributes` failure fails the node's optional
    /// attribute reads (title, value, description), which then read unknown.
    /// A secure text field (`AXSecureTextField`) never reports its value.
    fn observe(&mut self, h: &AxHandle) -> CoreResult<AxObserved> {
        let mut props = self.props(h)?;
        let attributes_failed = self.begin(FakeMethod::AxAttributes).is_err();
        let secure = props.native_role == "AXSecureTextField";
        let read = |field: &mut Option<String>, withheld: bool| {
            if attributes_failed || withheld {
                *field = None;
                EvidenceState::Unknown
            } else {
                presence(field.is_some())
            }
        };
        let evidence = AxEvidence {
            title: read(&mut props.title, false),
            value: read(&mut props.value, secure),
            description: read(&mut props.description, false),
            enabled: EvidenceState::Known,
            focused: EvidenceState::Known,
            bounds: presence(props.bounds.is_some()),
        };
        Ok(AxObserved {
            props,
            evidence: Some(evidence),
            secure,
        })
    }

    fn identifier(&mut self, h: &AxHandle) -> CoreResult<Option<String>> {
        self.ax_tree.identifier(node_id(h)?)
    }

    fn parent(&mut self, h: &AxHandle) -> CoreResult<Option<AxHandle>> {
        self.begin(FakeMethod::AxParent)?;
        Ok(self.ax_tree.parent(node_id(h)?)?.map(AxHandle::Id))
    }

    fn perform(&mut self, h: &AxHandle, action: &str) -> CoreResult<()> {
        let reply = self.begin_write(AxWrite::AxPerform)?;
        let node = node_id(h)?;
        self.ax_tree.check_action(node, action)?;
        self.press_check(FakeMethod::AxPerform)?;
        self.record(SinkOp::AxPerform {
            node,
            action: action.to_string(),
        });
        reply.confirm(&format!("AX action '{action}'"))
    }

    fn set_value(&mut self, h: &AxHandle, value: &str) -> CoreResult<()> {
        let reply = self.begin_write(AxWrite::AxSetValue)?;
        let node = node_id(h)?;
        self.press_check(FakeMethod::AxSetValue)?;
        self.ax_tree.set_value(node, value)?;
        self.record(SinkOp::AxSetValue {
            node,
            value: value.to_string(),
        });
        reply.confirm("setting AXValue")
    }

    fn focus(&mut self, h: &AxHandle) -> CoreResult<()> {
        let reply = self.begin_write(AxWrite::AxFocus)?;
        let node = node_id(h)?;
        self.press_check(FakeMethod::AxFocus)?;
        self.ax_tree.focus(node)?;
        self.record(SinkOp::AxFocus { node });
        reply.confirm("setting AXFocused=true")
    }

    fn element_at(&mut self, x: f64, y: f64) -> CoreResult<Option<AxHandle>> {
        self.begin(FakeMethod::AxElementAt)?;
        Ok(self.ax_tree.element_at(x, y).map(AxHandle::Id))
    }

    fn focused_element(&mut self) -> CoreResult<Option<AxHandle>> {
        self.begin(FakeMethod::AxFocusedElement)?;
        Ok(self.ax_tree.focused().map(AxHandle::Id))
    }

    fn attributes(&mut self, h: &AxHandle) -> CoreResult<Vec<(String, String)>> {
        self.begin(FakeMethod::AxAttributes)?;
        self.ax_tree.attributes(node_id(h)?)
    }

    fn owner(&mut self, h: &AxHandle, _windows: &[DesktopWindow]) -> CoreResult<AxOwner> {
        self.begin(FakeMethod::AxOwner)?;
        let window = self.ax_tree.window_of(node_id(h)?)?;
        Ok(match window {
            Some(id) if !self.ax_owner_unknown => AxOwner::Window(id),
            _ => AxOwner::Unknown,
        })
    }
}

const fn presence(present: bool) -> EvidenceState {
    if present {
        EvidenceState::Known
    } else {
        EvidenceState::Absent
    }
}

#[cfg(test)]
#[path = "ax_web_tests.rs"]
mod web_tests;

#[cfg(test)]
mod tests {
    use senpi_desktop_core::ax::{AxBackend, AxHandle};
    use senpi_desktop_core::error::ErrorCode;
    use senpi_desktop_core::types::{AxEvidence, EvidenceState};

    use crate::{FakeBackend, FakeMethod, FakeScenario};

    use EvidenceState::{Absent, Known, Unknown};

    fn fake() -> FakeBackend {
        FakeBackend::new(
            FakeScenario::from_json(
                r#"{"windows": [{"id": "101", "title": "T", "app": "A", "pid": 1, "x": 0, "y": 0,
                     "width": 10, "height": 10, "focused": true, "elevated": null}],
                    "ax": {"101": {"role": "window", "title": "T", "children": [
                        {"role": "textfield", "native_role": "AXTextField", "title": "Name", "value": "Q",
                         "bounds": {"x": 1, "y": 1, "width": 5, "height": 5}},
                        {"role": "textfield", "native_role": "AXSecureTextField", "title": "Password", "value": "s"}]}}}"#,
            )
            .expect("scenario parses"),
        )
    }

    fn evidence(
        title: EvidenceState,
        value: EvidenceState,
        description: EvidenceState,
        bounds: EvidenceState,
    ) -> AxEvidence {
        AxEvidence {
            title,
            value,
            description,
            enabled: Known,
            focused: Known,
            bounds,
        }
    }

    #[test]
    fn evidence_states_map_from_scripted_data_and_attribute_errors() {
        // Given: node 2 is a plain text field, node 3 a secure one.
        let mut fake = fake();
        // When: node 2 reads cleanly, then again with its attribute reads failing.
        let clean = fake.observe(&AxHandle::Id(2)).expect("observes");
        fake.fail_next(FakeMethod::AxAttributes, ErrorCode::AxFailed);
        let failed = fake.observe(&AxHandle::Id(2)).expect("observes");
        let secure = fake.observe(&AxHandle::Id(3)).expect("observes");
        // Then
        assert_eq!(clean.evidence, Some(evidence(Known, Known, Absent, Known)));
        assert_eq!(clean.props.value.as_deref(), Some("Q"));
        assert!(!clean.secure);
        assert_eq!(
            failed.evidence,
            Some(evidence(Unknown, Unknown, Unknown, Known))
        );
        assert_eq!((failed.props.title, failed.props.value), (None, None));
        assert_eq!(
            secure.evidence,
            Some(evidence(Known, Unknown, Absent, Absent))
        );
        assert!(secure.secure && secure.props.value.is_none());
    }

    #[test]
    fn plain_props_keep_the_secure_value_for_null_mode() {
        // Given / When
        let props = fake().props(&AxHandle::Id(3)).expect("reads");
        // Then: only the object-mode read withholds it.
        assert_eq!(props.value.as_deref(), Some("s"));
    }
}
