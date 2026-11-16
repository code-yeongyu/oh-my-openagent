//! Refs bound to retained `AXUIElement`s: one handle per element, with the window identity it
//! was read under and, when the private symbol resolved, its remote token.

use std::collections::BTreeMap;

use omo_computer_core::ax::AxHandle;

use super::seam::Element;

/// One retained element and the identity it is bound to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Retained {
    pub element: Element,
    pub window: u32,
    pub pid: u32,
    pub process_start: u64,
    pub token: Option<Vec<u8>>,
}

/// The handle table of one session.
#[derive(Debug, Default)]
pub struct Handles {
    next: u64,
    by_handle: BTreeMap<u64, Retained>,
    by_element: BTreeMap<Element, u64>,
}

impl Handles {
    /// The handle of `retained.element`, minting one the first time it is seen.
    pub fn retain(&mut self, retained: Retained) -> AxHandle {
        if let Some(handle) = self.by_element.get(&retained.element) {
            return AxHandle(*handle);
        }
        self.next += 1;
        self.by_element.insert(retained.element, self.next);
        self.by_handle.insert(self.next, retained);
        AxHandle(self.next)
    }

    #[must_use]
    pub fn get(&self, handle: AxHandle) -> Option<&Retained> {
        self.by_handle.get(&handle.0)
    }
}
