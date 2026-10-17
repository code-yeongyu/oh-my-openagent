//! `ax.click`: a coordinate click at an element's centre, delivered to the
//! window the element lives in (#8959). The owner comes from the backend's
//! live AX lookup, never from window geometry, enumeration order, or the
//! ref's snapshot target.

use senpi_desktop_core::ax::{AxHandle, AxOwner};
use senpi_desktop_core::backend::PointerEvent;
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::protocol_params::AxClickParams;
use senpi_desktop_core::types::{DesktopWindow, Target};
use senpi_desktop_safety::MutatingAction;

use crate::mutate::Mutation;
use crate::pointer::ParsedPointerOptions;
use crate::request::Response;
use crate::worker::{Audited, Worker};

impl Worker {
    /// Clicks the centre of the element's bounds in the window that owns it.
    pub(crate) fn ax_click(
        &mut self,
        params: &AxClickParams,
        cancelled: &dyn Fn() -> bool,
    ) -> CoreResult<Audited> {
        let mode = ParsedPointerOptions::requested_mode(params.opts.as_ref());
        let mutation = Mutation::new(MutatingAction::AxClick, self.ref_target(&params.ref_), mode);
        self.mutate(&mutation, cancelled, |worker| worker.ax_click_now(params))
    }

    fn ax_click_now(&mut self, params: &AxClickParams) -> CoreResult<Response> {
        let options = ParsedPointerOptions::parse(params.opts.as_ref())?;
        let handle: AxHandle = self.registry.resolve(&params.ref_)?;
        let bounds = self
            .ax_parts()?
            .0
            .props(&handle)?
            .bounds
            .ok_or_else(|| DesktopError::ax_failed(format!("{} has no clickable bounds", params.ref_)))?;
        let x = bounds.x + bounds.width / 2.0;
        let y = bounds.y + bounds.height / 2.0;
        let window = self.owner_window(&params.ref_, &handle, x, y)?;
        let event = PointerEvent::Click {
            x,
            y,
            button: options.button,
            count: options.count,
            modifiers: options.modifiers,
        };
        self.backend()?.pointer(
            &Target::Window(window),
            event,
            &FrameGeometry::identity_global(),
            options.mode,
        )?;
        Ok(Response::Unit)
    }

    /// The id of the window that owns `handle`, named in the live window
    /// list: it must be listed and still contain (`x`, `y`).
    fn owner_window(&mut self, reference: &str, handle: &AxHandle, x: f64, y: f64) -> CoreResult<String> {
        let windows = self.backend()?.windows()?;
        let AxOwner::Window(id) = self.ax_parts()?.0.owner(handle, &windows)? else {
            return Err(refuse_unknown_owner(reference));
        };
        let window = windows
            .into_iter()
            .find(|window| window.id == id)
            .ok_or_else(|| {
                DesktopError::window_not_found(format!(
                    "window {id}, which owns {reference}, is no longer listed; take a fresh snapshot"
                ))
            })?;
        if !contains(&window, x, y) {
            return Err(DesktopError::ax_failed(format!(
                "the centre of {reference} is outside its window {id}; take a fresh snapshot before clicking"
            )));
        }
        Ok(id)
    }
}

/// The ownership policy for AX coordinate clicks: an element whose window
/// the backend cannot name is refused, never matched to a window by
/// geometry, because an overlapping window would receive the click.
fn refuse_unknown_owner(reference: &str) -> DesktopError {
    DesktopError::ax_failed(format!(
        "the window that owns {reference} cannot be determined, so a coordinate click could reach \
         another window; use ax.perform (for example press) on the ref, or click screenshot \
         coordinates instead"
    ))
}

fn contains(window: &DesktopWindow, x: f64, y: f64) -> bool {
    let (left, top) = (f64::from(window.x), f64::from(window.y));
    (left..left + f64::from(window.width)).contains(&x) && (top..top + f64::from(window.height)).contains(&y)
}
