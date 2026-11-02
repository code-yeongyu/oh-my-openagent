//! Bounded keyboard and pointer mutations. All native input is released
//! before `mutate` restores focus/cursor or relinquishes the transaction.

use std::time::Duration;

use senpi_desktop_core::backend::MouseButton;
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::holds::{HoldControl, MouseHold};
use senpi_desktop_core::keys::parse_keys;
use senpi_desktop_core::protocol_params::{HoldKeysParams, HoldMouseParams};
use senpi_desktop_core::types::Target;
use senpi_desktop_safety::MutatingAction;

use crate::mutate::Mutation;
use crate::pointer::ParsedPointerOptions;
use crate::request::Response;
use crate::worker::{Audited, Worker};

impl Worker {
    pub(crate) fn hold_keys(
        &mut self,
        params: &HoldKeysParams,
        cancelled: &dyn Fn() -> bool,
    ) -> CoreResult<Audited> {
        let duration = hold_duration(params.duration)?;
        let target = Target::parse(&params.target);
        let mutation = Mutation {
            keys: Some(&params.keys),
            ..Mutation::new(
                MutatingAction::HoldKeys,
                target.key().to_owned(),
                ParsedPointerOptions::requested_mode(params.opts.as_ref()),
            )
        };
        let supervisor = self.safety.supervisor.clone();
        let signal = self.hold_signal.clone().unwrap_or_else(|| supervisor.hold_signal());
        self.mutate(&mutation, cancelled, |worker| {
            let keys = parse_keys(&params.keys)?;
            if keys.is_empty() {
                return Err(DesktopError::invalid_key("held keys must not be empty"));
            }
            let mode = ParsedPointerOptions::parse(params.opts.as_ref())?.mode;
            if matches!(target, Target::Window(_)) {
                worker.window(&target)?;
            }
            let check = || {
                if cancelled() {
                    signal.cancel();
                }
                signal.check(&supervisor)
            };
            let wait = || {
                check()?;
                signal.wait(&supervisor, duration)
            };
            signal.with_input(&supervisor, || {
                worker.backend()?.hold_keys(&target, &keys, mode, &HoldControl { check: &check, wait: &wait })
            })?;
            Ok(Response::Unit)
        })
    }

    pub(crate) fn hold_mouse(
        &mut self,
        params: &HoldMouseParams,
        cancelled: &dyn Fn() -> bool,
    ) -> CoreResult<Audited> {
        let duration = hold_duration(params.duration)?;
        let target = Target::parse(&params.target);
        let mutation = Mutation {
            frame_id: params.frame_id.as_deref(),
            keys: params.keys.as_deref(),
            ..Mutation::new(
                MutatingAction::HoldMouse,
                target.key().to_owned(),
                ParsedPointerOptions::requested_mode(params.opts.as_ref()),
            )
        };
        let supervisor = self.safety.supervisor.clone();
        let signal = self.hold_signal.clone().unwrap_or_else(|| supervisor.hold_signal());
        self.mutate(&mutation, cancelled, |worker| {
            let keys = match params.keys.as_deref() {
                None => Vec::new(),
                Some([]) => Vec::new(),
                Some(keys) => parse_keys(keys)?,
            };
            let button = MouseButton::parse(params.button.as_deref())?;
            let mode = ParsedPointerOptions::parse(params.opts.as_ref())?.mode;
            let (frame, current) = worker.frame_for(&target, params.frame_id.as_deref())?;
            let (x, y) = frame.map_point(params.x, params.y, current.as_ref())?;
            let check = || {
                if cancelled() {
                    signal.cancel();
                }
                signal.check(&supervisor)
            };
            let wait = || {
                check()?;
                signal.wait(&supervisor, duration)
            };
            signal.with_input(&supervisor, || worker.backend()?.hold_mouse(
                &target,
                &MouseHold { x, y, button, keys: &keys },
                mode,
                &HoldControl { check: &check, wait: &wait },
            ))?;
            Ok(Response::Unit)
        })
    }
}

fn hold_duration(seconds: f64) -> CoreResult<Duration> {
    if !seconds.is_finite() || !(0.0..=100.0).contains(&seconds) {
        return Err(DesktopError::internal("hold params bypassed duration parsing"));
    }
    Ok(Duration::from_secs_f64(seconds))
}

#[cfg(test)]
mod tests;
