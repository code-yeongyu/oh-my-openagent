//! A scripted UI Automation source: elements keyed by RuntimeId, children per parent, and a
//! count of every call the reader makes, so a test reads what the walk asked for.

use std::collections::BTreeMap;

use omo_computer_core::ax::Slice;

use crate::uia::cache::CacheRequest;
use crate::uia::element::{Toast, UiaElement, UiaError};
use crate::uia::source::UiaSource;

#[derive(Default)]
pub struct FakeUia {
    pub elements: Vec<UiaElement>,
    pub children: BTreeMap<Vec<i32>, Vec<Vec<i32>>>,
    pub provider: String,
    pub elevated: bool,
    pub focused: Option<Vec<i32>>,
    pub toasts: Option<Vec<Toast>>,
    pub calls: Vec<String>,
    pub requests: Vec<CacheRequest>,
    pub clock_ms: u64,
}

pub fn element(runtime_id: &[i32], control_type: &str, name: &str) -> UiaElement {
    UiaElement {
        runtime_id: runtime_id.to_vec(),
        control_type: control_type.to_owned(),
        name: Some(name.to_owned()).filter(|n| !n.is_empty()),
        hwnd: 0x1234,
        top_level: 0x1234,
        pid: 4242,
        process_start: 77,
        enabled: true,
        ..UiaElement::default()
    }
}

impl FakeUia {
    /// A WinForms window: root, a text box and a password box.
    pub fn winforms() -> Self {
        let mut root = element(&[42, 1], "Window", "Fixture");
        root.class_name = Some("WindowsForms10.Window.8.app.0.1".to_owned());
        root.child_count = 2;
        let mut text = element(&[42, 2], "Edit", "Name");
        text.value = Some("hello".to_owned());
        let mut password = element(&[42, 3], "Edit", "Password");
        // A WinForms/Win32 edit box is its own child window under the form (review M1 of #13837).
        password.hwnd = 0x5678;
        password.value = Some("hunter2".to_owned());
        password.is_password = true;
        let mut children = BTreeMap::new();
        children.insert(vec![42, 1], vec![vec![42, 2], vec![42, 3]]);
        Self {
            elements: vec![root, text, password],
            children,
            provider: "[pid:4242,providerId:0x0 Main(parent link):Microsoft: MSAA Proxy (unmanaged:uiautomationcore.dll)]".to_owned(),
            ..Self::default()
        }
    }

    fn get(&self, id: &[i32]) -> Option<UiaElement> {
        self.elements.iter().find(|e| e.runtime_id == id).cloned()
    }
}

impl UiaSource for FakeUia {
    fn now_ms(&self) -> u64 {
        self.clock_ms
    }

    fn elevated(&mut self, _hwnd: isize) -> Option<bool> {
        self.calls.push("elevated".to_owned());
        Some(self.elevated)
    }

    fn root(&mut self, _hwnd: isize) -> Result<UiaElement, UiaError> {
        self.calls.push("root".to_owned());
        self.elements.first().cloned().ok_or(UiaError::Gone)
    }

    fn provider_description(&mut self, _root: &UiaElement) -> String {
        self.calls.push("provider_description".to_owned());
        self.provider.clone()
    }

    fn children(
        &mut self,
        parent: &UiaElement,
        request: &CacheRequest,
        from: u32,
        _slice_ms: u64,
    ) -> Slice<Vec<UiaElement>> {
        self.calls.push("children".to_owned());
        self.requests.push(request.clone());
        let ids = self.children.get(&parent.runtime_id).cloned().unwrap_or_default();
        let from = usize::try_from(from).unwrap_or(usize::MAX);
        Slice::Read(ids.iter().skip(from).filter_map(|id| self.get(id)).collect())
    }

    fn refresh(&mut self, element: &UiaElement, _slice_ms: u64) -> Slice<Option<UiaElement>> {
        self.calls.push("refresh".to_owned());
        Slice::Read(self.get(&element.runtime_id))
    }

    fn find_runtime_id(&mut self, _hwnd: isize, runtime_id: &[i32]) -> Vec<UiaElement> {
        self.elements.iter().filter(|e| e.runtime_id == runtime_id).cloned().collect()
    }

    fn focused(&self) -> Option<UiaElement> {
        self.focused.as_deref().and_then(|id| self.get(id))
    }

    fn toasts(&mut self) -> Option<Vec<Toast>> {
        self.toasts.clone()
    }
}
