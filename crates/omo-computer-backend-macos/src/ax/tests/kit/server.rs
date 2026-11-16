//! The scripted AX server's calls.

use omo_computer_core::ax::Slice;

use super::fake::FakeAx;
use crate::ax::seam::{
    Attributes, AxServer, AxStatus, AxValue, Element, Notified, RemoteToken, WindowOwner,
};

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
        self.arrive();
        *self.reads.entry(element).or_default() += 1;
        if self.gone.contains(&element) {
            return Slice::Read(None);
        }
        Slice::Read(self.nodes.get(&element).map(|(a, c)| Attributes {
            child_count: u32::try_from(c.len()).unwrap_or(u32::MAX),
            ..a.clone()
        }))
    }

    fn actions(&mut self, element: Element, _slice_ms: u64) -> Slice<Vec<String>> {
        self.action_reads += 1;
        Slice::Read(self.action_names.get(&element).cloned().unwrap_or_default())
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
            self.schedule(poke);
        }
    }

    fn observe(&mut self, pid: u32) -> bool {
        self.observed.push(pid);
        if self.refuse_observe > 0 {
            self.refuse_observe -= 1;
            return false;
        }
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
        if attribute == "AXManualAccessibility" {
            if let Some(arrival) = self.on_manual.take() {
                self.schedule(arrival);
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
