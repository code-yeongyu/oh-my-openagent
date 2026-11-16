//! A scripted AX server: a node table, a fake clock that only the observer wait and node
//! reads advance, and counters for every call the rules care about.

use std::collections::{BTreeMap, VecDeque};

use omo_computer_core::ax::Slice;

use crate::ax::seam::{
    Attributes, AxServer, AxStatus, AxValue, Element, Notified, RemoteToken, WindowOwner,
};

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

/// What happens when the app's role is poked: after `delay` the node gets `children` and one
/// notification arrives.
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
    pub token: Option<FakeToken>,
}

pub fn node(role: &str) -> Attributes {
    Attributes {
        role: role.to_owned(),
        ..Attributes::default()
    }
}

pub fn owner(pid: u32, start: u64) -> WindowOwner {
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
}

impl AxServer for FakeAx {
    fn now_ms(&self) -> u64 {
        self.now
    }

    fn window_owner(&mut self, number: u32) -> Option<WindowOwner> {
        self.windows.get(&number).map(|(o, _)| o.clone())
    }

    fn window(&mut self, pid: u32, number: u32) -> Option<Element> {
        self.windows
            .get(&number)
            .filter(|(o, _)| o.pid == pid)
            .map(|(_, e)| *e)
    }

    fn app(&mut self, pid: u32) -> Option<Element> {
        self.apps.get(&pid).copied()
    }

    fn menu_bar(&mut self, pid: u32) -> Option<Element> {
        self.menu_bars.get(&pid).copied()
    }

    fn read(&mut self, element: Element, _slice_ms: u64) -> Slice<Option<Attributes>> {
        self.now += self.read_cost_ms;
        *self.reads.entry(element).or_default() += 1;
        if self.gone.contains(&element) {
            return Slice::Read(None);
        }
        Slice::Read(self.nodes.get(&element).map(|(a, c)| Attributes {
            child_count: u32::try_from(c.len()).unwrap_or(u32::MAX),
            ..a.clone()
        }))
    }

    fn children(
        &mut self,
        element: Element,
        from: u32,
        count: u32,
        _slice_ms: u64,
    ) -> Slice<Vec<Element>> {
        let children = self
            .nodes
            .get(&element)
            .map(|(_, c)| c.clone())
            .unwrap_or_default();
        Slice::Read(
            children
                .into_iter()
                .skip(from as usize)
                .take(count as usize)
                .collect(),
        )
    }

    fn poke_role(&mut self, _app: Element) {
        self.pokes += 1;
        if let Some(poke) = self.on_poke.take() {
            let at = self.now + poke.delay;
            let pid = self.windows.values().next().map_or(0, |(o, _)| o.pid);
            let window = self
                .windows
                .iter()
                .find(|(_, (_, e))| *e == poke.node)
                .map(|(n, _)| *n);
            self.queue.push_back((
                at,
                Notified {
                    notification: "AXLayoutChanged".into(),
                    pid,
                    element: poke.node,
                    window,
                },
            ));
            self.nodes.get_mut(&poke.node).expect("poked node").1 = poke.children;
        }
    }

    fn observe(&mut self, pid: u32) -> bool {
        self.observed.push(pid);
        true
    }

    fn wait_notification(&mut self, until_ms: u64) -> Option<Notified> {
        self.waits += 1;
        match self.queue.front() {
            Some((at, _)) if *at <= until_ms => {
                let (at, event) = self.queue.pop_front()?;
                self.now = self.now.max(at);
                Some(event)
            }
            _ => {
                self.now = self.now.max(until_ms);
                None
            }
        }
    }

    fn perform(&mut self, element: Element, action: &str) -> AxStatus {
        if self.gone.contains(&element) {
            return AxStatus::Gone;
        }
        if self
            .unsupported
            .iter()
            .any(|(e, a)| *e == element && a == action)
        {
            return AxStatus::Unsupported;
        }
        self.performed.push((element, action.to_owned()));
        AxStatus::Done
    }

    fn set(&mut self, element: Element, attribute: &str, value: AxValue) -> AxStatus {
        if let (AxValue::Text(text), Some((attributes, _))) = (&value, self.nodes.get_mut(&element))
        {
            if attribute == "AXValue" {
                attributes.value = Some(text.clone());
            }
        }
        self.writes.push((element, attribute.to_owned(), value));
        AxStatus::Done
    }

    fn process_of_bundle(&mut self, bundle: &str) -> Option<u32> {
        self.bundles.get(bundle).copied()
    }

    fn is_electron(&mut self, pid: u32) -> bool {
        self.electron.contains(&pid)
    }

    fn remote_token(&mut self) -> Option<&mut dyn RemoteToken> {
        self.token.as_mut().map(|t| t as &mut dyn RemoteToken)
    }
}
