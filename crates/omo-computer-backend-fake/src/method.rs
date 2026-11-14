//! The names of the fake's calls, which scripts key on (`after_call`, `before`, `fail_next`).

use std::collections::BTreeMap;

use omo_computer_core::backend::InputEvent;
use serde::Deserialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FakeMethod {
    Windows,
    Displays,
    Capture,
    Click,
    PointerMove,
    Key,
    Scroll,
    TypeText,
    AxSnapshot,
    AxResolve,
    AxPerform,
    AxSetValue,
    AxFocus,
    AxTypeText,
    MenuSelect,
    ClipboardRead,
    ClipboardWrite,
    SetFrame,
    FocusRecord,
}

impl FakeMethod {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Windows => "windows",
            Self::Displays => "displays",
            Self::Capture => "capture",
            Self::Click => "click",
            Self::PointerMove => "pointer_move",
            Self::Key => "key",
            Self::Scroll => "scroll",
            Self::TypeText => "type_text",
            Self::AxSnapshot => "ax_snapshot",
            Self::AxResolve => "ax_resolve",
            Self::AxPerform => "ax_perform",
            Self::AxSetValue => "ax_set_value",
            Self::AxFocus => "ax_focus",
            Self::AxTypeText => "ax_type_text",
            Self::MenuSelect => "menu_select",
            Self::ClipboardRead => "clipboard_read",
            Self::ClipboardWrite => "clipboard_write",
            Self::SetFrame => "set_frame",
            Self::FocusRecord => "focus_record",
        }
    }

    /// The call an OS input event counts as.
    #[must_use]
    pub const fn of_input(event: &InputEvent) -> Self {
        match event {
            InputEvent::PointerMove(_) => Self::PointerMove,
            InputEvent::Button { .. } => Self::Click,
            InputEvent::Key { .. } => Self::Key,
            InputEvent::Scroll { .. } => Self::Scroll,
            InputEvent::Text(_) => Self::TypeText,
        }
    }

    /// The call a semantic AX action counts as.
    #[must_use]
    pub fn of_action(action: &str) -> Self {
        match action {
            "set_value" => Self::AxSetValue,
            "focus" => Self::AxFocus,
            "type_text" => Self::AxTypeText,
            _ => Self::AxPerform,
        }
    }

    #[must_use]
    pub const fn is_ax_write(self) -> bool {
        matches!(
            self,
            Self::AxPerform | Self::AxSetValue | Self::AxFocus | Self::AxTypeText
        )
    }
}

/// How often each call ran.
#[derive(Debug, Clone, Default)]
pub struct CallCounter {
    counts: BTreeMap<FakeMethod, u32>,
}

impl CallCounter {
    /// Counts one call and returns its ordinal (from 1).
    pub fn record(&mut self, method: FakeMethod) -> u32 {
        let count = self.counts.entry(method).or_insert(0);
        *count = count.saturating_add(1);
        *count
    }

    #[must_use]
    pub fn count(&self, method: FakeMethod) -> u32 {
        self.counts.get(&method).copied().unwrap_or(0)
    }
}
