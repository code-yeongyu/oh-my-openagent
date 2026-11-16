//! Batched reads (d-windows.md '## UI Automation'): one `IUIAutomationCacheRequest` per walk
//! with the property set below; the root's `ProviderDescription` chooses whether to batch: Skip
//! when every provider is client-side `uiautomationcore.dll` in-process, Batch otherwise
//! (`WinForms` MSAA proxies are named by `pid:`).

/// The cached property set of every read.
pub const PROPERTIES: &[&str] = &[
    "Name",
    "ControlType",
    "LocalizedControlType",
    "AutomationId",
    "ClassName",
    "FrameworkId",
    "BoundingRectangle",
    "IsEnabled",
    "IsOffscreen",
    "IsKeyboardFocusable",
    "HasKeyboardFocus",
    "IsPassword",
    "NativeWindowHandle",
    "ProcessId",
    "RuntimeId",
    "Value.Value",
    "Toggle.ToggleState",
    "ExpandCollapse.State",
    "SelectionItem.IsSelected",
    "LegacyIAccessible.Name",
    "LegacyIAccessible.Value",
];

/// Whether a walk batches its reads through the cache request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Batching {
    Skip,
    Batch,
}

/// The cache request of one walk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CacheRequest {
    pub batching: Batching,
    pub properties: &'static [&'static str],
}

/// A provider named by a non-zero `pid:` is out of process.
fn names_a_process(description: &str) -> bool {
    description.split("pid:").skip(1).any(|rest| {
        let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
        !digits.trim_start_matches('0').is_empty()
    })
}

/// Every provider's module is the client-side `uiautomationcore.dll`.
fn client_side_only(description: &str) -> bool {
    let modules: Vec<&str> = description
        .split('(')
        .skip(1)
        .filter_map(|group| group.split(')').next())
        .collect();
    !modules.is_empty()
        && modules
            .iter()
            .all(|module| module.to_ascii_lowercase().ends_with(":uiautomationcore.dll"))
}

/// The cache request a walk under a root with `provider_description` uses.
#[must_use]
pub fn cache_request(provider_description: &str) -> CacheRequest {
    let skip = client_side_only(provider_description) && !names_a_process(provider_description);
    CacheRequest {
        batching: if skip { Batching::Skip } else { Batching::Batch },
        properties: PROPERTIES,
    }
}
