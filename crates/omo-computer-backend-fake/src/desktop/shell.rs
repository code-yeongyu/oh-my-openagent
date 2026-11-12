//! The fake host's consent view (row 21) and the shell reads of row 25: menus, apps, system
//! surfaces. Each is scripted by the scenario; nothing here sends anything.

use omo_computer_core::backend::{BackendResult, InputEvent, Refusal};
use omo_computer_core::error::EngineCode;
use omo_computer_core::listing::{AppInfo, ElementInfo, SurfaceKind};
use omo_computer_core::menus::MenuNode;
use omo_computer_core::surface::ShellReader;
use omo_computer_core::untrusted::UntrustedText;

use crate::backend::FakeBackend;
use crate::sink::quoted;
use crate::scenario::{FakeAxNode, FakeMenuNode};

impl FakeBackend {
    /// The scenario's `consent` block, with `fullAccess` set when the scenario scripts the
    /// full-access preset; neither present is no host view.
    pub(super) fn fake_host_consent(&self) -> Option<serde_json::Value> {
        let state = self.lock();
        let full_access = state.scenario.full_access_preset;
        match state.scenario.consent.clone() {
            Some(serde_json::Value::Object(mut view)) => {
                if full_access {
                    view.insert("fullAccess".to_owned(), serde_json::Value::Bool(true));
                }
                Some(serde_json::Value::Object(view))
            }
            Some(other) => Some(other),
            None => full_access.then(|| serde_json::json!({ "fullAccess": true })),
        }
    }

    fn fake_menu_tree(&self, window: &str) -> BackendResult<Vec<MenuNode>> {
        let menus = self.menus(window).ok_or(Refusal::bare(EngineCode::AxUnsupported))?;
        Ok(menus.iter().map(menu_node).collect())
    }

    fn fake_apps(&self) -> Vec<AppInfo> {
        let apps = self.lock().scenario.apps.clone();
        apps.into_iter()
            .map(|app| AppInfo {
                identity: app.pid.and_then(|pid| self.code_identity(pid)),
                app_key: app.app_key,
                name: app.name,
                pid: app.pid,
                running: app.running,
                source: app.source,
                path: app.path,
                observation: UntrustedText,
            })
            .collect()
    }

    fn fake_surfaces(&self) -> Vec<SurfaceKind> {
        let kinds: Vec<String> = self.lock().scenario.surfaces.keys().cloned().collect();
        kinds
            .into_iter()
            .filter_map(|kind| serde_json::from_value(serde_json::Value::String(kind)).ok())
            .collect()
    }

    fn fake_surface_tree(&self, kind: SurfaceKind) -> BackendResult<Vec<ElementInfo>> {
        let window = omo_computer_core::surface::kind_name(kind);
        let root = self.lock().scenario.surfaces.get(&window).cloned().ok_or(
            omo_computer_core::surface::SURFACE_UNSUPPORTED,
        )?;
        let mut out = Vec::new();
        flatten(&root, &window, &mut out);
        Ok(out)
    }

    /// A second handle on the same scripted state, for a test that changes the scenario under a
    /// session that owns the first.
    #[must_use]
    pub fn handle(&self) -> Self {
        Self {
            shared: self.shared.clone(),
            sink: self.sink.clone(),
            clock: self.clock.clone(),
            persona: self.persona,
            stop_path: self.stop_path,
        }
    }

    /// Replaces a window's menu tree, as an app that relabels its menu between two reads does.
    pub fn set_menus(&self, window: &str, menus: Vec<FakeMenuNode>) {
        self.lock().scenario.menus.insert(window.to_owned(), menus);
    }
}

impl ShellReader for FakeBackend {
    fn menu_tree(&mut self, window: &str) -> BackendResult<Vec<MenuNode>> {
        self.fake_menu_tree(window)
    }

    fn apps(&mut self) -> BackendResult<Vec<AppInfo>> {
        Ok(self.fake_apps())
    }

    fn surfaces(&self) -> Vec<SurfaceKind> {
        self.fake_surfaces()
    }

    fn surface_tree(&mut self, kind: SurfaceKind) -> BackendResult<Vec<ElementInfo>> {
        self.fake_surface_tree(kind)
    }

    fn browser_url(&mut self, window: &str) -> Option<Option<String>> {
        self.lock().scenario.browser_urls.get(window).cloned()
    }
}

/// The sink line of a row-25 side effect (the menu, app and system-surface events).
pub(super) fn event_line(event: &InputEvent) -> String {
    match event {
        InputEvent::MenuSelect { path } => format!("menu_select path={}", quoted(&path.join(" > "))),
        InputEvent::AppLaunch { app_key, activate } => format!("app_launch {} activate={activate}", quoted(app_key)),
        InputEvent::AppQuit { app_key, force } => format!("app_quit {} force={force}", quoted(app_key)),
        InputEvent::OpenSurface { kind } => format!("open_surface {kind:?}").to_lowercase(),
        other => format!("{other:?}"),
    }
}

fn menu_node(node: &FakeMenuNode) -> MenuNode {
    MenuNode {
        title: node.title.clone(),
        enabled: node.enabled.unwrap_or(true),
        checked: node.checked,
        accelerator: node.shortcut.clone(),
        children: node.children.iter().map(menu_node).collect(),
    }
}

fn flatten(node: &FakeAxNode, window: &str, out: &mut Vec<ElementInfo>) {
    out.push(ElementInfo {
        reference: format!("{window}:{}", out.len() + 1),
        role: node.role.clone(),
        label: node.title.clone(),
        native_role: node.native_role.clone(),
        title: node.title.clone(),
        description: node.description.clone(),
        value: node.value.clone(),
        enabled: node.enabled,
        focused: Some(node.focused),
        child_count: u32::try_from(node.children.len()).ok(),
        bounds: node.bounds,
        actions: Some(node.actions.clone()),
        window: window.to_owned(),
        generation: 0,
        observation: UntrustedText,
    });
    for child in &node.children {
        flatten(child, window, out);
    }
}
