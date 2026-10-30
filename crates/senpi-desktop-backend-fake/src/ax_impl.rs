use senpi_desktop_core::ax::{AxBackend, AxHandle, AxOwner, AxProps};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::protocol_results::AxTextSelection;
use senpi_desktop_core::text_range::{utf16_slice, TextSelectRequest};
use senpi_desktop_core::types::DesktopWindow;

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
        let reply = self.begin_write(AxWrite::AxPerform)?;
        let node = node_id(h)?;
        self.ax_tree.check_action(node, action)?;
        self.record(SinkOp::AxPerform {
            node,
            action: action.to_string(),
        });
        reply.confirm(&format!("AX action '{action}'"))
    }

    fn set_value(&mut self, h: &AxHandle, value: &str) -> CoreResult<()> {
        let reply = self.begin_write(AxWrite::AxSetValue)?;
        let node = node_id(h)?;
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

    /// Locates the request in the node's value and selects it; an
    /// `ax_cannot_complete` fault leaves the write unanswered after it landed.
    fn select_text(&mut self, h: &AxHandle, request: &TextSelectRequest) -> CoreResult<AxTextSelection> {
        let node = node_id(h)?;
        let value = self
            .ax_tree
            .value(node)?
            .ok_or_else(|| DesktopError::ax_failed(format!("fake AX node {node} has no text value; nothing was selected")))?;
        let range = request.locate(&value)?;
        let reply = self.begin_write(AxWrite::AxSelectText)?;
        self.ax_tree.select(node, range)?;
        let to_u32 = |units: usize| u32::try_from(units).map_err(|_| DesktopError::internal("selection offset exceeds u32"));
        self.record(SinkOp::AxSelectText {
            node,
            start: to_u32(range.start)?,
            length: to_u32(range.length)?,
        });
        reply.confirm("setting the selected text range")?;
        Ok(AxTextSelection {
            start: to_u32(range.start)?,
            length: to_u32(range.length)?,
            text: utf16_slice(&value, range).unwrap_or_default().to_owned(),
            focused: self.ax_tree.props(node)?.focused,
        })
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
