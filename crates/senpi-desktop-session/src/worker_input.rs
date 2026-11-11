//! Pointer and keyboard requests. Coordinates are pixels of the target's
//! latest capture and map through its frame to global logical points.

use senpi_desktop_core::ax::AxOwner;
use senpi_desktop_core::backend::{DeliveryMode, PointerEvent};
use senpi_desktop_core::error::{CoreResult, DesktopError, ErrorCode, ErrorReport};
use senpi_desktop_core::frame::{FrameGeometry, PointHit};
use senpi_desktop_core::keys::{dangerous_chord, parse_keys, ChordHost, KeyName};
use senpi_desktop_core::methods::Method;
use senpi_desktop_core::protocol_params::{
    DragParams, KeyChordParams, PointParams, ScrollParams, TypeTextParams,
};
use senpi_desktop_core::report::{ActionEffect, ActionHit, Disposition, NextCall, ReportMode};
use senpi_desktop_core::types::{DesktopWindow, PointerOptions, Target};
use senpi_desktop_safety::{GateError, MutatingAction, StopPolicy, Supervisor};
use serde_json::{Map, Value};

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
        if self.epochs.probe().moved() {
            return Err(crate::epoch::superseded_before_input());
        }
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
        let baseline = std::cell::Cell::new(None);
        let audited = self.mutate(&mutation, cancelled, |worker| {
            let options = ParsedPointerOptions::parse(params.opts.as_ref())?;
            let (frame, current) = worker.frame_for(&target, params.frame_id.as_deref())?;
            let (x, y) = frame.map_point(params.x, params.y, current.as_ref())?;
            worker.read_hit(x, y);
            baseline.set(worker.surface_baseline(&target));
            let event = PointerEvent::Click {
                x,
                y,
                button: options.button,
                count: options.count,
                modifiers: options.modifiers,
            };
            let response = worker
                .pointer(&target, event, &frame, options.mode)
                .map_err(|error| with_next_call(error, || element_at(&target, x, y)))?;
            if options.count > 1 {
                worker.judge(&target, &frame)?;
            }
            Ok(response)
        })?;
        self.report_opened_surfaces(baseline.take());
        Ok(audited)
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
            worker.pointer(&target, PointerEvent::Move { x, y }, &frame, mode)
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
            worker.judge(&target, &frame)?;
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
            worker.pointer(&target, event, &frame, mode)
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
        let secure = std::cell::Cell::new(false);
        let (response, event) = self.mutate(&mutation, cancelled, |worker| {
            let mode = delivery(params.opts.as_ref())?;
            worker.takeover_gate(&target, mode)?;
            secure.set(worker.typing_into_secure_field(&target));
            let epoch = worker.epochs.probe();
            let check_stop = || {
                interrupted(&supervisor, &policy, cancelled, "typing")?;
                epoch_unmoved(&epoch, mutation.text_delivered.get() > 0)
            };
            worker
                .backend()?
                .type_text_interruptible(
                    &target,
                    &params.text,
                    mode,
                    &check_stop,
                    &mut || mutation.text_delivered.set(mutation.text_delivered.get().saturating_add(1)),
                )
                .map_err(|error| with_next_call(error, || target_tree(&target)))?;
            Ok(Response::Unit)
        })?;
        if !secure.get() {
            return Ok((response, event));
        }
        // A secure field's value is never read back: the write stays
        // unverifiable, and the report says why.
        let extras = self.report_extras.take().unwrap_or_default();
        let mut report = crate::report::success_report(&event, extras);
        report.effect = ActionEffect::Unverifiable;
        report.warning = Some("secure_field".to_owned());
        Ok((Response::Action(Box::new(report)), event))
    }

    /// DESIGN 7 step 0, for background keys in an object-mode session: when
    /// the target window's app is frontmost and the user pressed a key or
    /// clicked in it within [`crate::intervention::TAKEOVER_MS`], nothing is
    /// sent. Without a front-window read or a watch there is no evidence, and
    /// the input proceeds as before.
    fn takeover_gate(&mut self, target: &Target, mode: DeliveryMode) -> CoreResult<()> {
        if self.registry.report_mode() != ReportMode::Object
            || mode != DeliveryMode::Background
            || !matches!(target, Target::Window(_))
        {
            return Ok(());
        }
        let Some(window) = self.window(target).ok().filter(|window| window.pid.is_some()) else {
            return Ok(());
        };
        let front = self.backend()?.front_window().ok().flatten();
        if front.is_none_or(|front| Some(front.pid) != window.pid) {
            return Ok(());
        }
        let Some(idle) = window.pid.and_then(|pid| self.user_active_in(pid)) else {
            return Ok(());
        };
        Err(DesktopError::background_unavailable(format!(
            "the user is using {} (last input {:.1} s ago) and it is the frontmost app; nothing was sent; \
             retry once they pause",
            window.app,
            idle as f64 / 1000.0,
        ))
        .with_report(ErrorReport {
            reason: Some("user_active_in_target".to_owned()),
            disposition: Some(Disposition::NOT_DELIVERED_AFTER_USER),
            ..ErrorReport::default()
        }))
    }

    /// Object mode: whether the element that takes the keys is a secure text
    /// field. The element is the target app's own focused element, read from
    /// that app (background keys land there even while another app is
    /// frontmost), and it must sit in the target window; it is secure when its
    /// own role says so or the hit at its center does. A read that fails says
    /// no.
    fn typing_into_secure_field(&mut self, target: &Target) -> bool {
        let Target::Window(id) = target else { return false };
        if self.registry.report_mode() != ReportMode::Object {
            return false;
        }
        let Ok(backend) = self.backend() else { return false };
        let Ok(windows) = backend.windows() else { return false };
        let pid = windows.iter().find(|window| window.id == *id).and_then(|window| window.pid);
        let center = {
            let Some(ax) = backend.ax() else { return false };
            let focused = match pid {
                Some(pid) => ax.app_focused_element(pid),
                None => ax.focused_element(),
            };
            let Ok(Some(element)) = focused else { return false };
            if !matches!(ax.owner(&element, &windows), Ok(AxOwner::Window(owner)) if owner == *id) {
                return false;
            }
            if ax.is_secure_text_field(&element).unwrap_or(false) {
                return true;
            }
            let Some(bounds) = ax.props(&element).ok().and_then(|props| props.bounds) else { return false };
            (bounds.x + bounds.width / 2.0, bounds.y + bounds.height / 2.0)
        };
        backend.hit_at(center.0, center.1).ok().flatten().is_some_and(|hit| hit.secure)
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
        let baseline = std::cell::Cell::new(None);
        let audited = self.mutate(&mutation, cancelled, |worker| {
            let keys = parse_keys(&params.keys)?;
            let mode = delivery(params.opts.as_ref())?;
            worker.refuse_dangerous_chord(&keys, params.force, "it is sent only with force: true")?;
            worker.takeover_gate(&target, mode)?;
            baseline.set(worker.surface_baseline(&target));
            let epoch = worker.epochs.probe();
            let pressed = std::cell::Cell::new(false);
            let check_stop = || {
                interrupted(&supervisor, &policy, cancelled, "pressing keys")?;
                epoch_unmoved(&epoch, pressed.replace(true))
            };
            worker
                .backend()?
                .key_chord_interruptible(&target, &keys, mode, &check_stop)
                .map_err(|error| match mode {
                    DeliveryMode::Background => with_next_call(error, || chord_in_foreground(params)),
                    DeliveryMode::Foreground => error,
                })?;
            Ok(Response::Unit)
        })?;
        self.report_opened_surfaces(baseline.take());
        Ok(audited)
    }

    /// DESIGN 2 A13, object mode: `cmd+q`, `alt+f4` and `win+l` are sent
    /// only with `force: true`; without it nothing is sent. `remedy` says
    /// how the request could send it (a hold has no `force` and points to
    /// `keyChord`).
    pub(crate) fn refuse_dangerous_chord(&self, keys: &[KeyName], force: bool, remedy: &str) -> CoreResult<()> {
        if force || self.registry.report_mode() != ReportMode::Object {
            return Ok(());
        }
        let Some(chord) = dangerous_chord(keys, ChordHost::of_backend(&self.backend_name())) else {
            return Ok(());
        };
        Err(DesktopError::invalid_key(format!(
            "{chord} quits an app, closes a window or locks the screen, so {remedy}; nothing was sent"
        ))
        .with_report(ErrorReport {
            reason: Some("dangerous_chord".to_owned()),
            disposition: Some(Disposition::NOT_DELIVERED_SAFE),
            ..ErrorReport::default()
        }))
    }

    /// Object mode: the element under the mapped point, read before input
    /// is sent, for the report's `hit`. A read that fails reports no hit and
    /// never blocks the input.
    pub(crate) fn read_hit(&mut self, x: f64, y: f64) {
        if self.registry.report_mode() != ReportMode::Object {
            return;
        }
        let hit = self.backend().and_then(|backend| backend.hit_at(x, y)).ok().flatten().map(action_hit);
        self.report_extras.set(Some(ReportExtras { hit, ..ReportExtras::default() }));
    }

    /// Object mode, window targets, input of several events (a drag, a
    /// multi-click): once it was sent, judges it against the window as it is
    /// now. A window that closed, changed owner or changed size since capture
    /// may have taken part of the input elsewhere: `delivery_uncertain`. A
    /// single event is never judged: a click that closes its dialog or hands
    /// its window to another process has already landed where it was aimed.
    pub(crate) fn judge(&mut self, target: &Target, frame: &FrameGeometry) -> CoreResult<()> {
        if self.registry.report_mode() != ReportMode::Object || !matches!(target, Target::Window(_)) {
            return Ok(());
        }
        let current = self.window(target).map_err(uncertain)?;
        if frame.identity().is_some_and(|captured| current.identity.as_ref() != Some(captured)) {
            return Err(uncertain(DesktopError::from(GateError::IdentityChanged)));
        }
        frame.check_size(&current).map_err(uncertain)
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

/// The epoch probe of an interruptible input call, run after
/// [`interrupted`] before each event: a move before the first event refuses
/// it (nothing sent); a move after `sent` input ends it with the delivery
/// unknown.
fn epoch_unmoved(epoch: &crate::epoch::EpochProbe, sent: bool) -> CoreResult<()> {
    match (epoch.moved(), sent) {
        (false, _) => Ok(()),
        (true, false) => Err(crate::epoch::superseded_before_input()),
        (true, true) => Err(crate::epoch::superseded_mid_input()),
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

/// Adds the next rung of the refusal ladder (element action, keyboard,
/// foreground) to a `BackgroundUnavailable` refusal. A refusal that waits
/// for the user (`user_active_in_target`) has no rung to suggest.
pub(crate) fn with_next_call(mut error: DesktopError, next: impl FnOnce() -> NextCall) -> DesktopError {
    if error.code != ErrorCode::BackgroundUnavailable {
        return error;
    }
    let mut report = error.report.take().map(|report| *report).unwrap_or_default();
    if report.reason.as_deref() != Some("user_active_in_target") {
        report.next_call = Some(next());
    }
    error.with_report(report)
}

/// The element-action rung below a background click: read the element
/// under the point, whose ref takes `ax.perform`. `ax.elementAt` returns the
/// topmost element there, so where another window covers the target the
/// element belongs to that window: check its owner before acting on it.
fn element_at(target: &Target, x: f64, y: f64) -> NextCall {
    let mut args = Map::new();
    args.insert("target".to_owned(), Value::from(target.key()));
    args.insert("x".to_owned(), Value::from(x));
    args.insert("y".to_owned(), Value::from(y));
    NextCall { method: Method::AxElementAt, args }
}

/// The element-action rung below background typing: read the target
/// window's tree, whose `(focused)` element's ref takes `ax.typeText`. Never
/// `ax.focused`: that reads the system-wide focused element, the frontmost
/// app's field, not the refused background target. The text never enters
/// the hint.
fn target_tree(target: &Target) -> NextCall {
    let mut args = Map::new();
    args.insert("target".to_owned(), Value::from(target.key()));
    NextCall { method: Method::AxSnapshot, args }
}

/// The foreground rung above background keys: the same chord, delivered in
/// the foreground (which needs a control grant).
fn chord_in_foreground(params: &KeyChordParams) -> NextCall {
    let mut args = match serde_json::to_value(params) {
        Ok(Value::Object(args)) => args,
        _ => Map::new(),
    };
    let mut opts = match args.remove("opts") {
        Some(Value::Object(opts)) => opts,
        _ => Map::new(),
    };
    opts.insert("deliveryMode".to_owned(), Value::from("foreground"));
    args.insert("opts".to_owned(), Value::Object(opts));
    NextCall { method: Method::KeyChord, args }
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

#[cfg(test)]
#[path = "worker_input/takeover_tests.rs"]
mod takeover_tests;
