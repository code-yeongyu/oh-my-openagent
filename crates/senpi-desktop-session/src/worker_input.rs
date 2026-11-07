//! Pointer and keyboard requests. Coordinates are pixels of the target's
//! latest capture and map through its frame to global logical points.

use senpi_desktop_core::backend::{DeliveryMode, PointerEvent};
use senpi_desktop_core::error::{CoreResult, DesktopError, ErrorCode};
use senpi_desktop_core::frame::{FrameGeometry, PointHit};
use senpi_desktop_core::keys::parse_keys;
use senpi_desktop_core::protocol_params::{
    DragParams, KeyChordParams, PointParams, ScrollParams, TypeTextParams,
};
use senpi_desktop_core::report::{ActionHit, Disposition, ReportMode};
use senpi_desktop_core::types::{DesktopWindow, PointerOptions, Target};

use senpi_desktop_safety::{GateError, MutatingAction, StopPolicy, Supervisor};

use crate::mutate::Mutation;
use crate::pointer::ParsedPointerOptions;
use crate::report::ReportExtras;
use crate::request::Response;
use crate::worker::{Audited, Worker};

impl Worker {
    /// The latest frame of `target` plus, for a window, its current geometry
    /// (a resize since capture fails `InvalidCoordinateFrame`).
    pub(crate) fn frame_for(
        &mut self,
        target: &Target,
        frame_id: Option<&str>,
    ) -> CoreResult<(FrameGeometry, Option<DesktopWindow>)> {
        let frame = self.frames.latest(target, frame_id)?;
        let current = match target {
            Target::Window(_) => Some(self.window(target)?),
            Target::Desktop | Target::Display(_) => None,
        };
        Ok((frame, current))
    }

    fn pointer(
        &mut self,
        target: &Target,
        event: PointerEvent,
        frame: &FrameGeometry,
        mode: DeliveryMode,
    ) -> CoreResult<Response> {
        self.backend()?.pointer(target, event, frame, mode)?;
        Ok(Response::Unit)
    }

    pub(crate) fn click(
        &mut self,
        params: &PointParams,
        cancelled: &dyn Fn() -> bool,
    ) -> CoreResult<Audited> {
        let target = Target::parse(&params.target);
        let mutation = Mutation {
            frame_id: params.frame_id.as_deref(),
            consume: consumes(params.opts.as_ref()),
            ..Mutation::new(
                MutatingAction::Click,
                target.key().to_owned(),
                ParsedPointerOptions::requested_mode(params.opts.as_ref()),
            )
        };
        self.mutate(&mutation, cancelled, |worker| {
            let options = ParsedPointerOptions::parse(params.opts.as_ref())?;
            let (frame, current) = worker.frame_for(&target, params.frame_id.as_deref())?;
            let (x, y) = frame.map_point(params.x, params.y, current.as_ref())?;
            worker.read_hit(x, y);
            let event = PointerEvent::Click {
                x,
                y,
                button: options.button,
                count: options.count,
                modifiers: options.modifiers,
            };
            let response = worker.pointer(&target, event, &frame, options.mode)?;
            worker.judge(&target, &frame, options.count > 1)?;
            Ok(response)
        })
    }

    pub(crate) fn move_mouse(
        &mut self,
        params: &PointParams,
        cancelled: &dyn Fn() -> bool,
    ) -> CoreResult<Audited> {
        let target = Target::parse(&params.target);
        let mutation = Mutation {
            frame_id: params.frame_id.as_deref(),
            consume: consumes(params.opts.as_ref()),
            ..Mutation::new(
                MutatingAction::MoveMouse,
                target.key().to_owned(),
                ParsedPointerOptions::requested_mode(params.opts.as_ref()),
            )
        };
        self.mutate(&mutation, cancelled, |worker| {
            let mode = delivery(params.opts.as_ref())?;
            let (frame, current) = worker.frame_for(&target, params.frame_id.as_deref())?;
            let (x, y) = frame.map_point(params.x, params.y, current.as_ref())?;
            worker.read_hit(x, y);
            let response = worker.pointer(&target, PointerEvent::Move { x, y }, &frame, mode)?;
            worker.judge(&target, &frame, false)?;
            Ok(response)
        })
    }

    pub(crate) fn drag(&mut self, params: &DragParams, cancelled: &dyn Fn() -> bool) -> CoreResult<Audited> {
        let target = Target::parse(&params.target);
        let mutation = Mutation {
            frame_id: params.frame_id.as_deref(),
            consume: consumes(params.opts.as_ref()),
            ..Mutation::new(
                MutatingAction::Drag,
                target.key().to_owned(),
                ParsedPointerOptions::requested_mode(params.opts.as_ref()),
            )
        };
        self.mutate(&mutation, cancelled, |worker| {
            let options = ParsedPointerOptions::parse(params.opts.as_ref())?;
            let (frame, current) = worker.frame_for(&target, params.frame_id.as_deref())?;
            let path = params
                .path
                .iter()
                .map(|point| frame.map_point(point.x, point.y, current.as_ref()))
                .collect::<CoreResult<Vec<_>>>()?;
            if let Some(&(x, y)) = path.first() {
                worker.read_hit(x, y);
            }
            let event = PointerEvent::Drag {
                path,
                button: options.button,
                modifiers: options.modifiers,
            };
            let response = worker.pointer(&target, event, &frame, options.mode)?;
            worker.judge(&target, &frame, true)?;
            Ok(response)
        })
    }

    pub(crate) fn scroll(
        &mut self,
        params: &ScrollParams,
        cancelled: &dyn Fn() -> bool,
    ) -> CoreResult<Audited> {
        let target = Target::parse(&params.target);
        let mutation = Mutation {
            frame_id: params.frame_id.as_deref(),
            consume: consumes(params.opts.as_ref()),
            ..Mutation::new(
                MutatingAction::Scroll,
                target.key().to_owned(),
                ParsedPointerOptions::requested_mode(params.opts.as_ref()),
            )
        };
        self.mutate(&mutation, cancelled, |worker| {
            let mode = delivery(params.opts.as_ref())?;
            let (frame, current) = worker.frame_for(&target, params.frame_id.as_deref())?;
            let (x, y) = frame.map_point(params.x, params.y, current.as_ref())?;
            worker.read_hit(x, y);
            let event = PointerEvent::Scroll {
                x,
                y,
                dx: params.dx,
                dy: params.dy,
            };
            let response = worker.pointer(&target, event, &frame, mode)?;
            worker.judge(&target, &frame, false)?;
            Ok(response)
        })
    }

    pub(crate) fn type_text(
        &mut self,
        params: &TypeTextParams,
        cancelled: &dyn Fn() -> bool,
    ) -> CoreResult<Audited> {
        let target = Target::parse(&params.target);
        let mutation = Mutation {
            text: Some(&params.text),
            ..Mutation::new(
                MutatingAction::TypeText,
                target.key().to_owned(),
                ParsedPointerOptions::requested_mode(params.opts.as_ref()),
            )
        };
        let supervisor = self.safety.supervisor.clone();
        let policy = self.stop_policy();
        self.mutate(&mutation, cancelled, |worker| {
            let mode = delivery(params.opts.as_ref())?;
            let check_stop = || interrupted(&supervisor, &policy, cancelled, "typing");
            worker.backend()?.type_text_interruptible(
                &target,
                &params.text,
                mode,
                &check_stop,
                &mut || mutation.text_delivered.set(mutation.text_delivered.get().saturating_add(1)),
            )?;
            Ok(Response::Unit)
        })
    }

    pub(crate) fn key_chord(
        &mut self,
        params: &KeyChordParams,
        cancelled: &dyn Fn() -> bool,
    ) -> CoreResult<Audited> {
        let target = Target::parse(&params.target);
        let mutation = Mutation {
            keys: Some(&params.keys),
            ..Mutation::new(
                MutatingAction::KeyChord,
                target.key().to_owned(),
                ParsedPointerOptions::requested_mode(params.opts.as_ref()),
            )
        };
        let supervisor = self.safety.supervisor.clone();
        let policy = self.stop_policy();
        self.mutate(&mutation, cancelled, |worker| {
            let keys = parse_keys(&params.keys)?;
            let mode = delivery(params.opts.as_ref())?;
            let check_stop = || interrupted(&supervisor, &policy, cancelled, "pressing keys");
            worker.backend()?.key_chord_interruptible(&target, &keys, mode, &check_stop)?;
            Ok(Response::Unit)
        })
    }

    /// Object mode: the element under the mapped point, read before input
    /// is sent, for the report's `hit`. A read that fails reports no hit and
    /// never blocks the input.
    pub(crate) fn read_hit(&mut self, x: f64, y: f64) {
        if self.registry.report_mode() != ReportMode::Object {
            return;
        }
        let hit = self.backend().and_then(|backend| backend.hit_at(x, y)).ok().flatten().map(action_hit);
        self.report_extras.set(Some(ReportExtras { route: None, hit, timings: None }));
    }

    /// Object mode, window targets: once input was sent, judges it against
    /// the window as it is now. A window whose owner changed, or (for input
    /// of several events, `multi_event`) whose size changed since capture,
    /// may have taken part of the input elsewhere: `delivery_uncertain`.
    pub(crate) fn judge(&mut self, target: &Target, frame: &FrameGeometry, multi_event: bool) -> CoreResult<()> {
        if self.registry.report_mode() != ReportMode::Object || !matches!(target, Target::Window(_)) {
            return Ok(());
        }
        let captured = frame.identity().cloned();
        if captured.is_none() && !multi_event {
            return Ok(());
        }
        let current = self.window(target).map_err(uncertain)?;
        if captured.is_some_and(|captured| current.identity.as_ref() != Some(&captured)) {
            return Err(uncertain(DesktopError::from(GateError::IdentityChanged)));
        }
        if multi_event {
            frame.check_size(&current).map_err(uncertain)?;
        }
        Ok(())
    }

    /// Raising a window is itself the focus change asked for: audited as
    /// foreground, and nothing is restored afterwards.
    pub(crate) fn raise_window(
        &mut self,
        window_id: &str,
        cancelled: &dyn Fn() -> bool,
    ) -> CoreResult<Audited> {
        let mutation = Mutation::new(
            MutatingAction::RaiseWindow,
            window_id.to_owned(),
            DeliveryMode::Foreground,
        );
        self.mutate(&mutation, cancelled, |worker| {
            worker.backend()?.raise_window(window_id)?;
            Ok(Response::Unit)
        })
    }
}

/// The check an interruptible input call runs before each press: a
/// suspension, then a stop path that stopped authorizing input, then a
/// cancellation; `doing` names the input in the error.
pub(crate) fn interrupted(
    supervisor: &Supervisor,
    policy: &StopPolicy,
    cancelled: &dyn Fn() -> bool,
    doing: &str,
) -> CoreResult<()> {
    let is_cancelled = cancelled();
    if supervisor.is_suspended() {
        Err(DesktopError::new(ErrorCode::Suspended, format!("input was suspended while {doing}")))
    } else if let Some(stopped) = crate::mutate::interruption(supervisor, policy) {
        Err(stopped)
    } else if is_cancelled {
        Err(DesktopError::new(ErrorCode::Cancelled, format!("the request was cancelled while {doing}")))
    } else {
        Ok(())
    }
}

/// Whether the request's options ask to consume its frame.
pub(crate) fn consumes(options: Option<&PointerOptions>) -> bool {
    options.is_some_and(|options| options.consume)
}

/// Longest label a report carries before it is cut.
const MAX_LABEL_CHARS: usize = 256;

/// The report's `hit`: a secure field's label is never reported, and a long
/// label is cut to 256 characters plus `[truncated]`.
fn action_hit(hit: PointHit) -> ActionHit {
    let label = hit.label.filter(|_| !hit.secure).map(|label| {
        if label.chars().count() > MAX_LABEL_CHARS {
            format!("{}[truncated]", label.chars().take(MAX_LABEL_CHARS).collect::<String>())
        } else {
            label
        }
    });
    ActionHit { role: hit.role, label }
}

/// An error judged after input was sent: whatever reason it carries, the
/// input may have landed, and sending it again may duplicate it.
fn uncertain(mut error: DesktopError) -> DesktopError {
    let mut report = error.report.take().map(|report| *report).unwrap_or_default();
    report.disposition = Some(Disposition::UNCERTAIN_UNSAFE);
    error.with_report(report)
}

/// Only the delivery mode matters for these requests, but malformed options
/// still fail like they do for a click.
pub(crate) fn delivery(options: Option<&PointerOptions>) -> CoreResult<DeliveryMode> {
    ParsedPointerOptions::parse(options).map(|options| options.mode)
}

#[cfg(test)]
#[path = "worker_input/frame_tests.rs"]
mod frame_tests;
