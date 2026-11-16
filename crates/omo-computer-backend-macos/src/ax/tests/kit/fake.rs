//! The scripted AX server's state: a node table, a fake clock that only the observer wait and
//! node reads advance, the scripted events, and counters for every call the rules care about.

use std::collections::{BTreeMap, VecDeque};

use crate::ax::seam::{Attributes, AxValue, Element, Notified, RemoteToken, WindowOwner};

#[derive(Default)]
pub struct FakeToken {
    pub calls: u32,
}

impl RemoteToken for FakeToken {
    fn token(&mut self, element: Element) -> Option<Vec<u8>> {
        self.calls += 1;
        Some(element.to_le_bytes().to_vec())
    }

    fn resolve(&mut self, token: &[u8]) -> Option<Element> {
        self.calls += 1;
        Some(Element::from_le_bytes(token.try_into().ok()?))
    }
}

/// A scripted tree arrival (on the role poke, or on the `AXManualAccessibility` write): after
/// `delay` the node gets `children` and one notification arrives.
pub struct OnPoke {
    pub delay: u64,
    pub node: Element,
    pub children: Vec<Element>,
}

#[derive(Default)]
pub struct FakeAx {
    pub now: u64,
    pub read_cost_ms: u64,
    pub nodes: BTreeMap<Element, (Attributes, Vec<Element>)>,
    pub windows: BTreeMap<u32, (WindowOwner, Element)>,
    pub apps: BTreeMap<u32, Element>,
    pub menu_bars: BTreeMap<u32, Element>,
    pub bundles: BTreeMap<String, u32>,
    pub electron: Vec<u32>,
    pub gone: Vec<Element>,
    pub reads: BTreeMap<Element, u32>,
    pub queue: VecDeque<(u64, Notified)>,
    pub waits: u32,
    pub observed: Vec<u32>,
    pub performed: Vec<(Element, String)>,
    pub writes: Vec<(Element, String, AxValue)>,
    pub unsupported: Vec<(Element, String)>,
    pub pokes: u32,
    pub on_poke: Option<OnPoke>,
    /// The tree that arrives once `AXManualAccessibility` is written.
    pub on_manual: Option<OnPoke>,
    /// Children that appear at a time: `(at, node, children)`.
    pub pending: Vec<(u64, Element, Vec<Element>)>,
    /// Action names answered only by the separate actions IPC.
    pub action_names: BTreeMap<Element, Vec<String>>,
    pub action_reads: u32,
    /// Observer registrations that fail before one succeeds.
    pub refuse_observe: u32,
    pub token: Option<FakeToken>,
}

pub fn node(role: &str) -> Attributes {
    Attributes {
        role: role.to_owned(),
        ..Attributes::default()
    }
}

fn owner(pid: u32, start: u64) -> WindowOwner {
    WindowOwner {
        pid,
        process_start: start,
        app: format!("App{pid}"),
        bundle: Some(format!("com.example.app{pid}")),
    }
}

impl FakeAx {
    pub fn add(&mut self, element: Element, attributes: Attributes, children: Vec<Element>) {
        self.nodes.insert(element, (attributes, children));
    }

    /// Window `number` of `pid` with root `element`, its app element `element + 1_000_000`.
    pub fn window(&mut self, number: u32, pid: u32, start: u64, element: Element) {
        self.windows.insert(number, (owner(pid, start), element));
        self.apps.entry(pid).or_insert(element + 1_000_000);
        self.nodes
            .entry(element + 1_000_000)
            .or_insert((node("AXApplication"), vec![element]));
    }

    /// A flat-then-deep tree: `count` nodes under `root`, `fanout` children each.
    pub fn tree(&mut self, root: Element, count: u64, fanout: u64) {
        let mut next = root + 1;
        let mut frontier = VecDeque::from([root]);
        let mut made = 1;
        self.add(root, node("AXWindow"), Vec::new());
        while let Some(parent) = frontier.pop_front() {
            for _ in 0..fanout {
                if made >= count {
                    return;
                }
                self.add(
                    next,
                    Attributes {
                        title: Some(format!("n{next}")),
                        ..node("AXButton")
                    },
                    Vec::new(),
                );
                self.nodes.get_mut(&parent).expect("parent").1.push(next);
                frontier.push_back(next);
                next += 1;
                made += 1;
            }
        }
    }

    /// Queues `arrival`: its event at `now + delay`, its children visible from then on.
    pub fn schedule(&mut self, arrival: OnPoke) {
        let at = self.now + arrival.delay;
        let pid = self.windows.values().next().map_or(0, |(o, _)| o.pid);
        let window = self
            .windows
            .iter()
            .find(|(_, (_, e))| *e == arrival.node)
            .map(|(n, _)| *n);
        self.queue.push_back((
            at,
            Notified {
                notification: "AXLayoutChanged".into(),
                pid,
                element: arrival.node,
                window,
            },
        ));
        self.pending.push((at, arrival.node, arrival.children));
    }

    /// Applies every pending arrival that is due.
    pub fn arrive(&mut self) {
        let now = self.now;
        let (due, later): (Vec<_>, Vec<_>) =
            self.pending.drain(..).partition(|(at, ..)| *at <= now);
        self.pending = later;
        for (_, node, children) in due {
            if let Some(entry) = self.nodes.get_mut(&node) {
                entry.1 = children;
            }
        }
    }
}
