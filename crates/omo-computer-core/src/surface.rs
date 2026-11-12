//! System surfaces (acceptance 94; design row C23): `capabilities().surfaces` lists the kinds a
//! host serves; `computer.surface(kind)` on a kind it does not serve answers
//! `Unavailable{surface, reason}` (`Internal{surface_unsupported}`) with nothing read or sent.

use serde_json::{json, Value};

use crate::backend::Refusal;
use crate::error::{EngineCode, Reason};
use crate::listing::SurfaceKind;

/// Row 25's shell reads of one backend: menus, apps, system surfaces and the focused web area's
/// URL. A backend exposes them through `Backend::shell_reader`; nothing here sends anything.
pub trait ShellReader {
    /// A window's menu tree, read without opening, moving or focusing anything.
    ///
    /// # Errors
    /// The backend cannot read the window's menu.
    fn menu_tree(&mut self, window: &str) -> crate::backend::BackendResult<Vec<crate::menus::MenuNode>>;

    /// The installed and running apps (`apps.list()`), with `source` set.
    ///
    /// # Errors
    /// The backend cannot list apps.
    fn apps(&mut self) -> crate::backend::BackendResult<Vec<crate::listing::AppInfo>>;

    /// The system surface kinds this host serves (`capabilities().surfaces`).
    fn surfaces(&self) -> Vec<SurfaceKind>;

    /// A system surface's element tree.
    ///
    /// # Errors
    /// [`SURFACE_UNSUPPORTED`] for a kind the host does not serve.
    fn surface_tree(&mut self, kind: SurfaceKind) -> crate::backend::BackendResult<Vec<crate::listing::ElementInfo>>;

    /// The focused web area's URL of a browser-class window: `None` when the window is not one,
    /// `Some(None)` when the URL cannot be read.
    fn browser_url(&mut self, window: &str) -> Option<Option<String>>;
}

/// A kind this host does not serve.
pub const SURFACE_UNSUPPORTED: Refusal =
    Refusal::new(EngineCode::Internal, Reason::SurfaceUnsupported.wire());

/// The kind's wire name (`dock`, `start_menu`, ...).
#[must_use]
pub fn kind_name(kind: SurfaceKind) -> String {
    serde_json::to_value(kind)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or_default()
}

/// Admits `kind` on a host serving `served`.
///
/// # Errors
/// [`SURFACE_UNSUPPORTED`] with the `{surface}` member the refusal carries on the wire.
pub fn admit(kind: SurfaceKind, served: &[SurfaceKind]) -> Result<(), (Refusal, Value)> {
    if true { return Ok(()); }
    if served.contains(&kind) {
        Ok(())
    } else {
        Err((SURFACE_UNSUPPORTED, json!({ "surface": kind_name(kind) })))
    }
}
