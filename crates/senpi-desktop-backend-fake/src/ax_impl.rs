use senpi_desktop_core::ax::{AxBackend, AxHandle, AxProps};
use senpi_desktop_core::error::CoreResult;
use senpi_desktop_core::types::DesktopWindow;

use crate::ax_tree::node_id;
use crate::fake::FakeBackend;
use crate::method::FakeMethod;
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

    fn children(&mut self, h: &AxHandle) -> CoreResult<Vec<AxHandle>> {
        self.begin(FakeMethod::AxChildren)?;
        let children = self.ax_tree.children(node_id(h)?)?;
        Ok(children.into_iter().map(AxHandle::Id).collect())
    }

    fn parent(&mut self, h: &AxHandle) -> CoreResult<Option<AxHandle>> {
        self.begin(FakeMethod::AxParent)?;
        Ok(self.ax_tree.parent(node_id(h)?)?.map(AxHandle::Id))
    }

    fn perform(&mut self, h: &AxHandle, action: &str) -> CoreResult<()> {
        self.begin(FakeMethod::AxPerform)?;
        let node = node_id(h)?;
        self.ax_tree.check_action(node, action)?;
        self.record(SinkOp::AxPerform {
            node,
            action: action.to_string(),
        });
        Ok(())
    }

    fn set_value(&mut self, h: &AxHandle, value: &str) -> CoreResult<()> {
        self.begin(FakeMethod::AxSetValue)?;
        let node = node_id(h)?;
        self.ax_tree.set_value(node, value)?;
        self.record(SinkOp::AxSetValue {
            node,
            value: value.to_string(),
        });
        Ok(())
    }

    fn focus(&mut self, h: &AxHandle) -> CoreResult<()> {
        self.begin(FakeMethod::AxFocus)?;
        let node = node_id(h)?;
        self.ax_tree.focus(node)?;
        self.record(SinkOp::AxFocus { node });
        Ok(())
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
}
