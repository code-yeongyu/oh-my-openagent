//! Menus: an item is selected by its exact label, level by level, through the action ladder.
//! A submenu's items are waited for on the bus's events, never with a sleep; two items with
//! the label are ambiguous.

use omo_computer_core::backend::{Delivered, Refusal};
use omo_computer_core::error::{EngineCode, Reason};

use crate::backend::{press, AtspiBackend};
use crate::bus::{read_slice, Bus, NodeId};
use crate::types::{AxRefusal, Detail};

const MENU_ROLES: &[&str] = &[
    "menu item",
    "menu",
    "check menu item",
    "radio menu item",
    "tearoff menu item",
];
const SEARCH_DEPTH: u32 = 8;
const SEARCH_BUDGET: usize = 600;
const SLICE_MS: u64 = 250;
/// How long one level waits for its submenu to appear.
const LEVEL_WAIT_MS: u64 = 2_000;

fn items<B: Bus>(bus: &mut B, root: &NodeId, label: &str) -> Vec<(NodeId, String)> {
    let slice = read_slice(SLICE_MS);
    let mut found = Vec::new();
    let mut queue = vec![(root.clone(), 0u32)];
    let mut seen = 0usize;
    while let Some((node, depth)) = queue.pop() {
        for kid in bus.children(&node, slice).unwrap_or_default() {
            seen += 1;
            if seen > SEARCH_BUDGET {
                return found;
            }
            let Ok(facts) = bus.read(&kid, slice) else {
                continue;
            };
            if MENU_ROLES.contains(&facts.role.as_str()) && facts.name.as_deref() == Some(label) {
                found.push((kid.clone(), facts.role.clone()));
            }
            if depth < SEARCH_DEPTH && facts.child_count > 0 {
                queue.push((kid, depth + 1));
            }
        }
    }
    found
}

impl<B: Bus> AtspiBackend<B> {
    /// Selects the menu item at `path` (exact labels, outermost first) in `window`.
    ///
    /// # Errors
    /// No bus, the window's join refusal, a level with no item of that label
    /// (`InvalidTarget`), two items with it (`InvalidTarget{ambiguous}`), or the ladder's refusal.
    pub fn select_menu(&mut self, window: &str, path: &[&str]) -> Result<Delivered, AxRefusal> {
        let frame = self.frame_for(window)?;
        let bus = self.live()?;
        let mut container = frame.node;
        let mut delivered = Delivered { count: 0, of: 0 };
        for label in path {
            let deadline = bus.now_ms() + LEVEL_WAIT_MS;
            let mut found = items(bus, &container, label);
            while found.is_empty() && bus.now_ms() < deadline {
                let left = deadline.saturating_sub(bus.now_ms());
                if bus
                    .wait_event(read_slice(left).max(std::time::Duration::from_millis(1)))
                    .ok()
                    .flatten()
                    .is_none()
                {
                    break;
                }
                found = items(bus, &container, label);
            }
            let (item, role) = match found.as_slice() {
                [] => return Err(AxRefusal::plain(Refusal::bare(EngineCode::InvalidTarget))),
                [one] => one.clone(),
                many => {
                    let candidates = many.iter().map(|(node, _)| node.object_id()).collect();
                    let refusal = Refusal::new(EngineCode::InvalidTarget, Reason::Ambiguous.wire());
                    return Err(AxRefusal::new(
                        refusal,
                        Detail::AmbiguousItem { candidates },
                    ));
                }
            };
            delivered = press(bus, &item, &role)?;
            container = item;
        }
        Ok(delivered)
    }
}
