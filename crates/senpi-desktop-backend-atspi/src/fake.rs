//! In-memory `AtSpiBus`: a registry of numbered nodes (0 is the null ref),
//! with a log of every mutating call so tests assert what reached the bus.

use std::collections::HashMap;

use atspi::{Interface, InterfaceSet, Role, State, StateSet};
use senpi_desktop_core::ax::AxHandle;

use crate::bus::{AtSpiBus, BusResult, Extents, ScreenPoint};

#[derive(Debug, Clone)]
pub(crate) struct FakeNode {
    pub(crate) name: String,
    pub(crate) description: String,
    pub(crate) role: Role,
    pub(crate) role_name: Option<String>,
    pub(crate) localized_role_name: Option<String>,
    pub(crate) state: StateSet,
    pub(crate) interfaces: InterfaceSet,
    pub(crate) attributes: Vec<(String, String)>,
    pub(crate) children: Vec<u64>,
    pub(crate) parent: u64,
    pub(crate) extents: Option<Extents>,
    pub(crate) hit: Option<u64>,
    pub(crate) actions: Vec<String>,
    pub(crate) action_succeeds: bool,
    pub(crate) text: String,
    pub(crate) text_accepted: bool,
    pub(crate) focus_accepted: bool,
}

impl FakeNode {
    pub(crate) fn new(role: Role, name: &str) -> Self {
        Self {
            name: name.to_string(),
            description: String::new(),
            role,
            role_name: Some(role.name().to_string()),
            localized_role_name: None,
            state: StateSet::new(State::Enabled),
            interfaces: InterfaceSet::new(Interface::Accessible),
            attributes: Vec::new(),
            children: Vec::new(),
            parent: 0,
            extents: None,
            hit: None,
            actions: Vec::new(),
            action_succeeds: true,
            text: String::new(),
            text_accepted: true,
            focus_accepted: true,
        }
    }

    /// A top-level frame at `extents`, implementing Component.
    pub(crate) fn frame(name: &str, extents: Extents) -> Self {
        let mut frame = Self::new(Role::Frame, name);
        frame.extents = Some(extents);
        frame.interfaces.insert(Interface::Component);
        frame
    }
}

#[derive(Debug, Default)]
pub(crate) struct FakeBus {
    pub(crate) nodes: HashMap<u64, FakeNode>,
    pub(crate) applications: Vec<u64>,
    pub(crate) pids: HashMap<u64, u32>,
    pub(crate) registry_down: bool,
    pub(crate) calls: Vec<String>,
}

impl FakeBus {
    /// Adds `node` as `id` under `parent` (0 registers an application).
    pub(crate) fn add(&mut self, id: u64, parent: u64, mut node: FakeNode) {
        node.parent = parent;
        if parent == 0 {
            self.applications.push(id);
        } else if let Some(owner) = self.nodes.get_mut(&parent) {
            owner.children.push(id);
        }
        self.nodes.insert(id, node);
    }

    fn get(&self, node: u64) -> BusResult<&FakeNode> {
        self.nodes
            .get(&node)
            .ok_or_else(|| format!("AT-SPI: object {node} is gone"))
    }
}

impl AtSpiBus for FakeBus {
    type Node = u64;

    fn applications(&mut self) -> BusResult<Vec<u64>> {
        if self.registry_down {
            return Err("AT-SPI applications: registry is not answering".to_string());
        }
        Ok(self.applications.clone())
    }

    fn process_id(&mut self, app: &u64) -> Option<u32> {
        self.pids.get(app).copied()
    }

    fn is_null(&self, node: &u64) -> bool {
        *node == 0
    }

    fn object_id(&self, node: &u64) -> String {
        format!("atspi::1.{node}:/org/a11y/atspi/accessible/{node}")
    }

    fn name(&mut self, node: &u64) -> BusResult<String> {
        Ok(self.get(*node)?.name.clone())
    }

    fn description(&mut self, node: &u64) -> BusResult<String> {
        Ok(self.get(*node)?.description.clone())
    }

    fn role(&mut self, node: &u64) -> BusResult<Role> {
        Ok(self.get(*node)?.role)
    }

    fn role_name(&mut self, node: &u64) -> BusResult<String> {
        self.get(*node)?
            .role_name
            .clone()
            .ok_or_else(|| "no role name".to_string())
    }

    fn localized_role_name(&mut self, node: &u64) -> BusResult<String> {
        self.get(*node)?
            .localized_role_name
            .clone()
            .ok_or_else(|| "no localized role name".to_string())
    }

    fn state(&mut self, node: &u64) -> BusResult<StateSet> {
        Ok(self.get(*node)?.state)
    }

    fn interfaces(&mut self, node: &u64) -> BusResult<InterfaceSet> {
        Ok(self.get(*node)?.interfaces)
    }

    fn attributes(&mut self, node: &u64) -> BusResult<Vec<(String, String)>> {
        Ok(self.get(*node)?.attributes.clone())
    }

    fn children(&mut self, node: &u64) -> BusResult<Vec<u64>> {
        Ok(self.get(*node)?.children.clone())
    }

    fn child_count(&mut self, node: &u64) -> BusResult<i32> {
        i32::try_from(self.get(*node)?.children.len()).map_err(|err| err.to_string())
    }

    fn parent(&mut self, node: &u64) -> BusResult<u64> {
        Ok(self.get(*node)?.parent)
    }

    fn extents(&mut self, node: &u64) -> BusResult<Extents> {
        self.get(*node)?.extents.ok_or_else(|| "no Component".to_string())
    }

    fn contains(&mut self, node: &u64, point: ScreenPoint) -> BusResult<bool> {
        let e = self.extents(node)?;
        Ok(point.x >= e.x && point.y >= e.y && point.x < e.x + e.width && point.y < e.y + e.height)
    }

    fn accessible_at_point(&mut self, node: &u64, point: ScreenPoint) -> BusResult<u64> {
        self.calls.push(format!("hit {node} @{},{}", point.x, point.y));
        Ok(self.get(*node)?.hit.unwrap_or(0))
    }

    fn grab_focus(&mut self, node: &u64) -> BusResult<bool> {
        self.calls.push(format!("focus {node}"));
        Ok(self.get(*node)?.focus_accepted)
    }

    fn actions(&mut self, node: &u64) -> BusResult<Vec<String>> {
        Ok(self.get(*node)?.actions.clone())
    }

    fn do_action(&mut self, node: &u64, index: i32) -> BusResult<bool> {
        self.calls.push(format!("action {node} #{index}"));
        Ok(self.get(*node)?.action_succeeds)
    }

    fn text(&mut self, node: &u64, max_chars: i32) -> BusResult<String> {
        let limit = usize::try_from(max_chars).map_err(|err| err.to_string())?;
        Ok(self.get(*node)?.text.chars().take(limit).collect())
    }

    fn set_text_contents(&mut self, node: &u64, text: &str) -> BusResult<bool> {
        self.calls.push(format!("text {node} {text}"));
        Ok(self.get(*node)?.text_accepted)
    }

    fn set_current_value(&mut self, node: &u64, value: f64) -> BusResult<()> {
        self.calls.push(format!("value {node} {value}"));
        self.get(*node).map(|_| ())
    }
}

pub(crate) const EDITOR_RECT: Extents = Extents {
    x: 10,
    y: 20,
    width: 640,
    height: 480,
};

/// One application (id 1, pid 4242) with a frame (id 10) holding a button
/// (id 11) and a focused multi-line text entry (id 12).
pub(crate) fn editor() -> FakeBus {
    let mut bus = FakeBus::default();
    bus.add(1, 0, FakeNode::new(Role::Application, "gedit"));
    bus.pids.insert(1, 4242);
    bus.add(10, 1, FakeNode::frame("notes.txt - gedit", EDITOR_RECT));
    let mut button = FakeNode::new(Role::Button, "Save");
    button.interfaces.insert(Interface::Action);
    button.actions = vec!["click".into(), "press".into(), "release".into()];
    bus.add(11, 10, button);
    let mut entry = FakeNode::new(Role::Entry, "Search");
    entry
        .interfaces
        .insert(Interface::Text | Interface::EditableText | Interface::Component);
    entry.text = "hello".into();
    entry.extents = Some(Extents {
        x: 30,
        y: 40,
        width: 200,
        height: 24,
    });
    entry.state.insert(State::MultiLine | State::Focused);
    bus.add(12, 10, entry);
    bus
}

/// The handle core hands back for node `id`.
pub(crate) fn node(id: u64) -> AxHandle {
    AxHandle::native(id)
}
