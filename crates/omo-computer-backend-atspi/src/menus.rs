//! Menus: the window's menu tree read into the core `MenuNode` shape without opening anything,
//! and `select` matched by EXACT label through the core's `prove` (a missing step is
//! `StaleRef`, two items with one label `AmbiguousTarget`), then pressed level by level through
//! the action ladder. A submenu that appears only once opened is waited for on the bus's
//! events, never with a sleep.

use std::time::Duration;

use omo_computer_core::backend::Delivered;
use omo_computer_core::error::EngineCode;
use omo_computer_core::menus::{prove, MenuNode};

use crate::backend::{press, AtspiBackend};
use crate::bus::{read_slice, Bus, NodeId};
use crate::types::AxRefusal;

const MENU_ROLES: &[&str] = &[
    "menu item",
    "menu",
    "check menu item",
    "radio menu item",
    "tearoff menu item",
];
/// Containers a menu bar or a menu's items may sit under.
const SEARCH_DEPTH: u32 = 8;
const SEARCH_BUDGET: usize = 2_048;
const SLICE_MS: u64 = 250;
/// How long one level waits for its submenu to appear.
const LEVEL_WAIT_MS: u64 = 2_000;

/// One menu node as read, with the bus object behind it.
struct MenuRead {
    id: NodeId,
    role: String,
    node: MenuNode,
}

fn read_level<B: Bus>(
    bus: &mut B,
    container: &NodeId,
    depth: u32,
    seen: &mut usize,
) -> Vec<MenuRead> {
    let slice = read_slice(SLICE_MS);
    let mut found = Vec::new();
    for kid in bus.children(container, slice).unwrap_or_default() {
        *seen += 1;
        if *seen > SEARCH_BUDGET {
            break;
        }
        let Ok(facts) = bus.read(&kid, slice) else {
            continue;
        };
        if MENU_ROLES.contains(&facts.role.as_str()) {
            let kids = read_level(bus, &kid, 0, seen);
            let node = MenuNode {
                title: facts.name.clone().unwrap_or_default(),
                enabled: facts.states.enabled,
                checked: facts.states.checked,
                accelerator: None,
                children: kids.iter().map(|read| read.node.clone()).collect(),
            };
            found.push(MenuRead {
                id: kid,
                role: facts.role,
                node,
            });
        } else if depth < SEARCH_DEPTH && facts.child_count > 0 {
            found.extend(read_level(bus, &kid, depth + 1, seen));
        }
    }
    found
}

fn nodes(reads: &[MenuRead]) -> Vec<MenuNode> {
    reads.iter().map(|read| read.node.clone()).collect()
}

fn step<'a>(reads: &'a [MenuRead], label: &str) -> Option<&'a MenuRead> {
    reads.iter().find(|read| read.node.title == label)
}

impl<B: Bus> AtspiBackend<B> {
    /// The menu tree of `window`, read without opening, moving or focusing anything.
    ///
    /// # Errors
    /// No bus, or the window's join refusal.
    pub fn menu_tree(&mut self, window: &str) -> Result<Vec<MenuNode>, AxRefusal> {
        let frame = self.frame_for(window)?;
        let bus = self.live()?;
        Ok(nodes(&read_level(bus, &frame.node, 0, &mut 0)))
    }

    /// Selects the menu item at `path` (exact labels, outermost first) in `window`: each level
    /// is proven from a fresh read, then pressed (opening it), the last one activating the item.
    ///
    /// # Errors
    /// No bus, the window's join refusal, the core `prove` refusal of a level, or the ladder's.
    pub fn select_menu(&mut self, window: &str, path: &[&str]) -> Result<Delivered, AxRefusal> {
        let frame = self.frame_for(window)?;
        let bus = self.live()?;
        let mut container = frame.node;
        let mut level = read_level(bus, &container, 0, &mut 0);
        let full: Vec<String> = path.iter().map(|label| (*label).to_owned()).collect();
        match prove(&nodes(&level), &full) {
            Err(refusal) if refusal.code != EngineCode::StaleRef => {
                return Err(AxRefusal::plain(refusal))
            }
            _ => {}
        }
        let mut delivered = Delivered { count: 0, of: 0 };
        for label in path {
            let label = (*label).to_owned();
            let deadline = bus.now_ms() + LEVEL_WAIT_MS;
            while step(&level, &label).is_none() && bus.now_ms() < deadline {
                let left = deadline.saturating_sub(bus.now_ms()).max(1);
                if bus
                    .wait_event(Duration::from_millis(left))
                    .ok()
                    .flatten()
                    .is_none()
                {
                    break;
                }
                level = read_level(bus, &container, 0, &mut 0);
            }
            prove(&nodes(&level), std::slice::from_ref(&label)).map_err(AxRefusal::plain)?;
            let Some(item) = step(&level, &label) else {
                break;
            };
            delivered = press(bus, &item.id, &item.role)?;
            container = item.id.clone();
            level = read_level(bus, &container, 0, &mut 0);
        }
        Ok(delivered)
    }
}
