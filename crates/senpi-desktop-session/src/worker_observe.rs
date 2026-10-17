//! Atomic observation and delivery of session-owned read state.

use senpi_desktop_core::ax;
use senpi_desktop_core::error::{CoreResult, DesktopError, ErrorCode};
use senpi_desktop_core::protocol_params::ObserveParams;
use senpi_desktop_core::types::{ObserveResult, Target};

use crate::budget::plan_screenshot;
use crate::request::{Op, Response};
use crate::session::guarded;
use crate::worker::Worker;
use crate::worker_capture::capture_response;

impl Worker {
    pub(crate) fn observe(
        &mut self,
        params: &ObserveParams,
        cancelled: &dyn Fn() -> bool,
    ) -> CoreResult<Response> {
        let target = Target::parse(&params.target);
        if !matches!(target, Target::Window(_)) {
            return Err(DesktopError::invalid_target("observe requires a window target"));
        }
        let window = self.window(&target)?;
        let budget = self.capture_budget(params.caps.as_ref())?;
        check_cancel(cancelled)?;
        let (image, mut geometry) = self.backend()?.capture(&target, budget.caps(), &[])?;
        let screenshot = plan_screenshot(image, &mut geometry, &budget)?;
        check_cancel(cancelled)?;
        let mut registry = self.registry.clone();
        let options = params.ax.clone().unwrap_or_default();
        let backend = self.backend()?.ax().ok_or_else(DesktopError::ax_unsupported)?;
        let snapshot = ax::snapshot(backend, &mut registry, &window, &options)?;
        check_cancel(cancelled)?;
        let legacy_capture = geometry.is_legacy_capture();
        let mut frames = self.frames.clone();
        let frame_id = frames.record(&target, geometry);
        let Response::Capture(capture) = capture_response(screenshot, &target, frame_id, None, window.is_on_screen, legacy_capture) else {
            return Err(DesktopError::internal("capture response has no frame"));
        };
        self.refresh_capabilities();
        self.frames = frames;
        self.registry = registry;
        Ok(Response::Observe(ObserveResult {
            capture,
            ax: snapshot.text,
            node_count: snapshot.node_count,
            truncated: snapshot.truncated,
        }))
    }

    pub(crate) fn dispatch(
        &mut self,
        op: Op,
        cancelled: &dyn Fn() -> bool,
        deliver: impl FnOnce(CoreResult<Response>) -> bool,
    ) {
        let checkpoint = matches!(op, Op::Observe(_))
            .then(|| (self.frames.clone(), self.registry.clone()));
        let result = guarded(|| self.process(op, cancelled));
        let success = result.is_ok();
        let delivered = deliver(result);
        if let Some((frames, registry)) = checkpoint.filter(|_| !success || !delivered) {
            self.frames.restore(frames);
            self.registry.restore(registry);
        }
    }
}

fn check_cancel(cancelled: &dyn Fn() -> bool) -> CoreResult<()> {
    if cancelled() {
        Err(DesktopError::new(ErrorCode::Cancelled, "observe was cancelled"))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests;
