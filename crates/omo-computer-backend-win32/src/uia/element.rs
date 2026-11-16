//! One UI Automation element as one cached read returns it (d-windows.md '## UI Automation',
//! Batched reads): the cached property set, read once per element by the reader.

use omo_computer_core::listing::Rect;

/// One element's cached properties.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct UiaElement {
    pub runtime_id: Vec<i32>,
    pub control_type: String,
    pub name: Option<String>,
    pub automation_id: Option<String>,
    pub class_name: Option<String>,
    pub value: Option<String>,
    pub is_password: bool,
    pub has_focus: bool,
    pub enabled: bool,
    pub bounds: Option<Rect>,
    pub hwnd: isize,
    /// The top-level window (`GetAncestor(GA_ROOT)`) the element lives in; a control's own
    /// `hwnd` is a child window, and a windowless element has none.
    pub top_level: isize,
    pub pid: u32,
    pub process_start: u64,
    pub child_count: u32,
}

/// Why the UI Automation client could not answer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UiaError {
    /// The element or window is gone (`UIA_E_ELEMENTNOTAVAILABLE`).
    Gone,
    /// The client could not be created or was denied (`CO_E_*`, `E_ACCESSDENIED`).
    Denied,
}

/// One toast as `ShellExperienceHost.exe` draws it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Toast {
    pub app: String,
    pub title: String,
    pub body: String,
}
