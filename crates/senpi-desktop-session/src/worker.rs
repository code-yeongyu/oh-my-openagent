//! The session thread's state and request dispatch.

use std::path::PathBuf;
use std::sync::Arc;

use parking_lot::Mutex;
use senpi_desktop_core::ax::{AxBackend, AxRegistry};
use senpi_desktop_core::backend::Backend;
use senpi_desktop_core::error::{CoreResult, DesktopError, ErrorCode};
use senpi_desktop_core::protocol_results::AuditEvent;
use senpi_desktop_core::types::{DesktopCapabilities, DesktopSessionOptions, DesktopWindow, Target};

use crate::audit::ArtifactGc;
use crate::mutate::SessionSafety;
use crate::pointer::FrameCache;
use crate::request::{Op, Response};
use crate::selection::BackendFactory;

/// Artifact-only screenshots of a session opened without `artifactDir` go
/// under this directory of the system temp dir.
const DEFAULT_ARTIFACT_DIR: &str = "senpi-desktop";

/// Owned by the session thread: AX handles are `Rc`, so it never leaves it.
pub(crate) struct Worker {
    pub(crate) hold_signal: Option<Arc<senpi_desktop_safety::HoldSignal>>,
    emergency: Option<Arc<dyn senpi_desktop_core::backend::EmergencyRelease>>,
    factory: Box<dyn BackendFactory>,
    pub(crate) backend: CoreResult<Box<dyn Backend>>,
    /// `Some` once `session.open` ran; backend requests need it.
    pub(crate) options: Option<DesktopSessionOptions>,
    pub(crate) registry: AxRegistry,
    pub(crate) frames: FrameCache,
    capabilities: Arc<Mutex<DesktopCapabilities>>,
    pub(crate) safety: SessionSafety,
    pub(crate) session_id: String,
    pub(crate) run_id: String,
    pub(crate) gc: ArtifactGc,
    /// Identifies this worker as the control slot's owner.
    pub(crate) instance: u64,
    /// This session's live foreground control grant, when it holds the slot.
    pub(crate) control: Option<crate::grant::ControlGrant>,
}

/// A mutating request's reply and the audit event it emitted.
pub(crate) type Audited = (Response, AuditEvent);

impl Worker {
    /// Builds the probe backend that answers `capabilities` before
    /// `session.open`.
    pub(crate) fn new(
        factory: Box<dyn BackendFactory>,
        capabilities: Arc<Mutex<DesktopCapabilities>>,
        safety: SessionSafety,
    ) -> Self {
        let backend = factory.create(&DesktopSessionOptions {
            show_cursor: false,
            ..DesktopSessionOptions::default()
        });
        let mut worker = Self {
            hold_signal: None,
            emergency: None,
            factory,
            backend,
            options: None,
            registry: AxRegistry::default(),
            frames: FrameCache::default(),
            capabilities,
            safety,
            session_id: String::new(),
            run_id: String::new(),
            gc: ArtifactGc::default(),
            instance: crate::grant::next_instance(),
            control: None,
        };
        worker.refresh_capabilities();
        worker
    }

    /// Applies cursor-only display changes in place; every other change
    /// re-creates the backend and invalidates earlier refs and frames.
    pub(crate) fn open(&mut self, options: DesktopSessionOptions) -> DesktopCapabilities {
        let cursor_only = self.options.as_ref().is_some_and(|current| {
            if current.show_cursor == options.show_cursor {
                return false;
            }
            let mut normalized = options.clone();
            normalized.show_cursor = current.show_cursor;
            normalized == *current
        });
        if cursor_only {
            if let Ok(backend) = self.backend.as_mut() {
                backend.set_show_cursor(options.show_cursor);
            }
            self.options = Some(options);
            return self.refresh_capabilities();
        }
        self.backend = self.factory.create(&options);
        self.emergency = self.backend.as_ref().ok().and_then(|backend| backend.emergency_release());
        if let Some(release) = &self.emergency {
            if let Err(error) = self.safety.supervisor.register_emergency_release(release) {
                self.backend = Err(error);
            }
        }
        self.registry = AxRegistry::default();
        self.frames = FrameCache::default();
        self.options = Some(options);
        self.session_id = ulid::Ulid::generate().to_string();
        self.run_id = ulid::Ulid::generate().to_string();
        self.gc = ArtifactGc::default();
        self.maybe_gc();
        self.refresh_capabilities()
    }

    pub(crate) fn artifact_dir(&self) -> PathBuf {
        self.options
            .as_ref()
            .and_then(|options| options.artifact_dir.clone())
            .unwrap_or_else(|| std::env::temp_dir().join(DEFAULT_ARTIFACT_DIR))
    }

    pub(crate) fn refresh_capabilities(&mut self) -> DesktopCapabilities {
        let capabilities = match self.backend.as_mut() {
            Ok(backend) => backend.capabilities(),
            Err(_) => DesktopCapabilities::unavailable(),
        };
        self.capabilities.lock().clone_from(&capabilities);
        capabilities
    }

    /// `cancelled` reports that the request's waiter gave up; mutation, zoom,
    /// and atomic observation consult it.
    pub(crate) fn process(&mut self, op: Op, cancelled: &dyn Fn() -> bool) -> CoreResult<Response> {
        if self.options.is_none() {
            return Err(DesktopError::new(
                ErrorCode::Closed,
                "desktop session is not open; call session.open first",
            ));
        }
        self.reconcile_grant();
        self.maybe_gc();
        let served = |audited: CoreResult<Audited>| audited.map(|(response, _audit)| response);
        // Every mutating request goes through `mutate`; reads bypass it.
        match op {
            Op::Displays => Ok(Response::Displays(self.backend()?.displays()?)),
            Op::Windows => Ok(Response::Windows(self.backend()?.windows()?)),
            Op::Capture(params) => self.capture(&params),
            Op::Observe(params) => self.observe(&params, cancelled),
            Op::CaptureRegion(params) => self.capture_region(&params, cancelled),
            Op::Click(params) => served(self.click(&params, cancelled)),
            Op::MoveMouse(params) => served(self.move_mouse(&params, cancelled)),
            Op::Drag(params) => served(self.drag(&params, cancelled)),
            Op::Scroll(params) => served(self.scroll(&params, cancelled)),
            Op::TypeText(params) => served(self.type_text(&params, cancelled)),
            Op::KeyChord(params) => served(self.key_chord(&params, cancelled)),
            Op::HoldKeys(params) => served(self.hold_keys(&params, cancelled)),
            Op::HoldMouse(params) => served(self.hold_mouse(&params, cancelled)),
            Op::RaiseWindow(params) => served(self.raise_window(&params.window_id, cancelled)),
            Op::AxSnapshot(params) => self.ax_snapshot(&params),
            Op::AxQuery(params) => self.ax_query(&params),
            Op::AxElementAt(params) => self.ax_element_at(&params),
            Op::AxFocused => self.ax_focused(),
            Op::AxNode(params) => self.ax_node(&params.ref_),
            Op::AxAttributes(params) => self.ax_attributes(&params.ref_),
            Op::AxChildren(params) => self.ax_children(&params.ref_),
            Op::AxParent(params) => self.ax_parent(&params.ref_),
            Op::AxPerform(params) => served(self.ax_perform(&params.ref_, &params.action, cancelled)),
            Op::AxSetValue(params) => served(self.ax_set_value(&params.ref_, &params.value, cancelled)),
            Op::AxFocus(params) => served(self.ax_focus(&params.ref_, cancelled)),
            Op::AxClick(params) => served(self.ax_click(&params, cancelled)),
            Op::ClipboardRead => self.clipboard_read(),
            Op::ClipboardWrite(params) => served(self.clipboard_write(&params, cancelled)),
            Op::ControlGrant(params) => self.control_grant(&params),
            Op::ControlRevoke => self.control_revoke(),
            Op::ControlState => Ok(Response::ControlState(self.control_state())),
            Op::MenuItems(params) => self.menu_items(&params),
            Op::MenusSelect(params) => served(self.menu_select(&params, cancelled)),
        }
    }

    pub(crate) fn backend(&mut self) -> CoreResult<&mut dyn Backend> {
        match self.backend.as_mut() {
            Ok(backend) => Ok(backend.as_mut()),
            Err(error) => Err(error.clone()),
        }
    }

    /// The accessibility backend and the ref registry, borrowed together.
    pub(crate) fn ax_parts(&mut self) -> CoreResult<(&mut dyn AxBackend, &mut AxRegistry)> {
        let backend = match self.backend.as_mut() {
            Ok(backend) => backend,
            Err(error) => return Err(error.clone()),
        };
        let ax = backend.ax().ok_or_else(DesktopError::ax_unsupported)?;
        Ok((ax, &mut self.registry))
    }

    /// The window `target` names; `desktop` means the focused window.
    pub(crate) fn window(&mut self, target: &Target) -> CoreResult<DesktopWindow> {
        let windows = self.backend()?.windows()?;
        match target {
            Target::Window(id) => windows
                .into_iter()
                .find(|window| window.id == *id)
                .ok_or_else(|| DesktopError::window_not_found(format!("window '{id}' was not found"))),
            Target::Desktop | Target::Display(_) => windows
                .into_iter()
                .find(|window| window.focused)
                .ok_or_else(|| DesktopError::window_not_found("no focused window was found")),
        }
    }
}
