//! `openedSurfaces` (DESIGN 2 G11): the windows an object-mode action
//! opened, found by diffing the window list read before the action against
//! the one read after it. A new window of the target's app is a `sheet`,
//! `dialog`, `menu` or `popover` when its accessibility root says so, else a
//! `window`. A title is reported only when neither the new surface nor the
//! window the action targeted holds a secure text field; a tree too large
//! to read within the walk budget counts as holding one (IS-12 redaction).

use std::collections::BTreeSet;

use senpi_desktop_core::ax::{register_node, AxHandle, AxOwner};
use senpi_desktop_core::report::{OpenedSurface, ReportMode};
use senpi_desktop_core::types::{DesktopWindow, Target};

use crate::worker::Worker;

/// Nodes a secure-field walk reads before it gives up (and redacts).
const SECURE_WALK_BUDGET: usize = 256;

/// Longest surface title a report carries before it is cut.
const MAX_TITLE_CHARS: usize = 256;

const SURFACE_ROLES: [&str; 4] = ["sheet", "dialog", "menu", "popover"];

/// The window list before an action, and whose windows count as opened by it.
#[derive(Debug, Default)]
pub(crate) struct SurfaceBaseline {
    known: BTreeSet<String>,
    /// The targeted window, whose secure fields redact what it opens.
    window: Option<DesktopWindow>,
    /// Only windows of this process count; `None` counts every new window.
    pid: Option<u32>,
}

impl Worker {
    /// The baseline for input sent to `target`; `None` outside object mode
    /// or when the window list cannot be read.
    pub(crate) fn surface_baseline(&mut self, target: &Target) -> Option<SurfaceBaseline> {
        if self.registry.report_mode() != ReportMode::Object {
            return None;
        }
        let windows = self.backend().ok()?.windows().ok()?;
        let window = match target {
            Target::Window(id) => windows.iter().find(|window| window.id == *id).cloned(),
            Target::Desktop | Target::Display(_) => None,
        };
        Some(baseline(windows, window))
    }

    /// The baseline for an accessibility action on `handle`: the window that
    /// owns it, when the backend can name it.
    pub(crate) fn element_surface_baseline(&mut self, handle: &AxHandle) -> Option<SurfaceBaseline> {
        if self.registry.report_mode() != ReportMode::Object {
            return None;
        }
        let backend = self.backend().ok()?;
        let windows = backend.windows().ok()?;
        let owner = match backend.ax()?.owner(handle, &windows) {
            Ok(AxOwner::Window(id)) => windows.iter().find(|window| window.id == id).cloned(),
            _ => None,
        };
        Some(baseline(windows, owner))
    }

    /// Lists the surfaces opened since `baseline` in the pending report.
    pub(crate) fn report_opened_surfaces(&mut self, baseline: Option<SurfaceBaseline>) {
        let Some(baseline) = baseline else { return };
        let surfaces = self.opened_surfaces(&baseline);
        if surfaces.is_empty() {
            return;
        }
        let mut extras = self.report_extras.take().unwrap_or_default();
        extras.opened_surfaces = surfaces;
        self.report_extras.set(Some(extras));
    }

    fn opened_surfaces(&mut self, baseline: &SurfaceBaseline) -> Vec<OpenedSurface> {
        let Ok(windows) = self.backend().and_then(|backend| backend.windows()) else {
            return Vec::new();
        };
        let opened: Vec<DesktopWindow> = windows
            .into_iter()
            .filter(|window| !baseline.known.contains(&window.id))
            .filter(|window| baseline.pid.is_none_or(|pid| window.pid == Some(pid)))
            .collect();
        if opened.is_empty() {
            return Vec::new();
        }
        let target_secure = baseline
            .window
            .as_ref()
            .is_some_and(|window| self.holds_secure_field(window).unwrap_or(true));
        opened
            .into_iter()
            .map(|window| self.surface(window, target_secure))
            .collect()
    }

    fn surface(&mut self, window: DesktopWindow, target_secure: bool) -> OpenedSurface {
        let root = self
            .ax_parts()
            .ok()
            .and_then(|(ax, registry)| {
                let handle = ax.window_root(&window).ok()?;
                let role = ax.props(&handle).ok()?.role;
                let node = register_node(ax, registry, &window.id, handle).ok()?;
                Some((role, node.ref_))
            });
        let kind = root
            .as_ref()
            .map(|(role, _)| role.as_str())
            .filter(|role| SURFACE_ROLES.contains(role))
            .unwrap_or("window")
            .to_owned();
        let secure = target_secure || self.holds_secure_field(&window).unwrap_or(true);
        let title = Some(window.title.clone())
            .filter(|title| !secure && !title.is_empty())
            .map(cut);
        OpenedSurface {
            kind,
            title,
            window_id: Some(window.id),
            ref_: root.map(|(_, reference)| reference),
        }
    }

    /// Whether `window`'s accessibility tree holds a secure text field.
    /// `None` when that cannot be read in full within the walk budget.
    fn holds_secure_field(&mut self, window: &DesktopWindow) -> Option<bool> {
        let ax = self.ax_parts().ok()?.0;
        let mut queue = vec![ax.window_root(window).ok()?];
        let mut read = 0;
        while let Some(handle) = queue.pop() {
            read += 1;
            if read > SECURE_WALK_BUDGET {
                return None;
            }
            if ax.observe(&handle).ok()?.secure {
                return Some(true);
            }
            queue.extend(ax.children(&handle).ok()?);
        }
        Some(false)
    }
}

fn baseline(windows: Vec<DesktopWindow>, window: Option<DesktopWindow>) -> SurfaceBaseline {
    SurfaceBaseline {
        known: windows.into_iter().map(|window| window.id).collect(),
        pid: window.as_ref().and_then(|window| window.pid),
        window,
    }
}

/// A title over 256 characters is cut and marked `[truncated]`.
fn cut(title: String) -> String {
    if title.chars().count() > MAX_TITLE_CHARS {
        format!("{}[truncated]", title.chars().take(MAX_TITLE_CHARS).collect::<String>())
    } else {
        title
    }
}
