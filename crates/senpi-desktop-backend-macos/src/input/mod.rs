//! Quartz input: CGEvent posting for the global desktop and per-window
//! SkyLight delivery, held-state tracking for `release_all`, and the SkyLight
//! receipt canary. The `Backend` wiring lives in [`crate::backend`].

mod background;
mod canary;
mod cgevent;
mod global;
mod guard;
mod held;
mod keys;
mod post;

#[cfg(test)]
mod tests;

#[cfg(test)]
mod live;

use core_graphics::event_source::CGEventSource;
use senpi_desktop_core::backend::{DeliveryMode, PointerEvent};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::keys::KeyName;
use senpi_desktop_core::types::{DesktopWindow, Target};

use crate::capture::MacCapture;
use crate::skylight;
use held::{Held, KeyRoute};

pub(crate) use self::canary::CANARY_STOP_REASON;
pub use self::canary::{CanaryMode, CanaryResult};
pub(crate) use self::cgevent::modifier_flags;
pub(crate) use self::keys::{key_code, update_modifier};

pub(crate) struct MacInput {
    source: CGEventSource,
    held: Held,
    canary: canary::CanaryState,
    /// `(pid, wid)` of the last window made key without raising, so key focus
    /// can be handed back afterwards.
    last_activated: Option<(libc::pid_t, u32)>,
}

// SAFETY: Core Graphics event sources are immutable CF objects after setup,
// and all access through `MacInput` requires `&mut self`, so events are posted
// serially after ownership moves between threads.
unsafe impl Send for MacInput {}

impl MacInput {
    pub(crate) fn new(canary: CanaryMode) -> CoreResult<Self> {
        Ok(Self {
            source: cgevent::event_source()?,
            held: Held::default(),
            canary: canary::CanaryState::new(canary),
            last_activated: None,
        })
    }

    /// Whether the receipt canary failed (drives `background_window_input`).
    pub(crate) fn canary_failed(&self) -> bool {
        self.canary.has_failed()
    }

    /// Applies the `computer.macosCanary` setting and re-arms the canary.
    pub(crate) fn configure_canary(&mut self, mode: CanaryMode) {
        self.canary = canary::CanaryState::new(mode);
    }

    /// Runs (or re-runs) the receipt canary on demand; `Off` is a no-op.
    pub(crate) fn canary(&mut self) -> CoreResult<CanaryResult> {
        if matches!(self.canary, canary::CanaryState::Off) {
            return Ok(CanaryResult { focus_restored: true });
        }
        canary::run(self)
    }

    /// Current global cursor position.
    pub(crate) fn cursor_position(&mut self) -> CoreResult<Option<senpi_desktop_core::types::DesktopPoint>> {
        crate::cursor::position(&self.source)
    }

    /// Moves the cursor without clicking.
    pub(crate) fn warp_cursor(&mut self, point: senpi_desktop_core::types::DesktopPoint) -> CoreResult<()> {
        crate::cursor::warp(&self.source, point)
    }

    /// Settles the canary state after one run.
    pub(super) fn settle_canary(&mut self, passed: bool) {
        self.canary = if passed {
            canary::CanaryState::Passed
        } else {
            canary::CanaryState::Failed
        };
    }

    /// Re-arms the canary for the next background action (`/computer resume`).
    pub(crate) fn rerun_canary(&mut self) {
        self.canary.rerun();
    }

    pub(crate) fn pointer(
        &mut self,
        target: &Target,
        event: PointerEvent,
        mode: DeliveryMode,
        capture: &MacCapture,
    ) -> CoreResult<()> {
        match target {
            Target::Desktop => global::pointer(&self.source, &mut self.held, event),
            Target::Window(id) => {
                let window = resolve_window(capture, id)?;
                let (pid, wid) = window_identity(&window)?;
                match mode {
                    DeliveryMode::Background => {
                        self.ensure_background_ready()?;
                        guard::guard(
                            &window,
                            guard::pointer_kind(&event),
                            guard::pointer_button(&event),
                        )?;
                        if !window.focused {
                            skylight::activate_without_raise(pid, wid)?;
                            self.last_activated = Some((pid, wid));
                        }
                        background::pointer(&self.source, &mut self.held, pid, wid, &window, event)
                    }
                    DeliveryMode::Foreground => skylight::with_foreground(pid, wid, || {
                        let _ = crate::ax::prepare_foreground_input(&window);
                        global::pointer(&self.source, &mut self.held, event)
                    }),
                }
            }
        }
    }

    pub(crate) fn type_text(
        &mut self,
        target: &Target,
        text: &str,
        mode: DeliveryMode,
        capture: &MacCapture,
    ) -> CoreResult<()> {
        match target {
            Target::Desktop => keys::type_text(&self.source, &mut self.held, text, KeyRoute::Global),
            Target::Window(id) => {
                let window = resolve_window(capture, id)?;
                let (pid, wid) = window_identity(&window)?;
                match mode {
                    DeliveryMode::Background => {
                        self.ensure_background_ready()?;
                        guard::guard(&window, "keyboard", None)?;
                        guard::prepare_keys(&window, pid, wid, capture)?;
                        self.last_activated = Some((pid, wid));
                        keys::type_text(&self.source, &mut self.held, text, KeyRoute::Process(pid))
                    }
                    DeliveryMode::Foreground => skylight::with_foreground(pid, wid, || {
                        let _ = crate::ax::prepare_foreground_input(&window);
                        keys::type_text(&self.source, &mut self.held, text, KeyRoute::Global)
                    }),
                }
            }
        }
    }

    pub(crate) fn key_chord(
        &mut self,
        target: &Target,
        chord: &[KeyName],
        mode: DeliveryMode,
        capture: &MacCapture,
    ) -> CoreResult<()> {
        match target {
            Target::Desktop => keys::chord(&self.source, &mut self.held, chord, KeyRoute::Global),
            Target::Window(id) => {
                let window = resolve_window(capture, id)?;
                let (pid, wid) = window_identity(&window)?;
                match mode {
                    DeliveryMode::Background => {
                        self.ensure_background_ready()?;
                        guard::guard(&window, "keyboard", None)?;
                        guard::prepare_keys(&window, pid, wid, capture)?;
                        self.last_activated = Some((pid, wid));
                        keys::chord(&self.source, &mut self.held, chord, KeyRoute::Process(pid))
                    }
                    DeliveryMode::Foreground => skylight::with_foreground(pid, wid, || {
                        let _ = crate::ax::prepare_foreground_input(&window);
                        keys::chord(&self.source, &mut self.held, chord, KeyRoute::Global)
                    }),
                }
            }
        }
    }

    /// The `(pid, wid)` a background action last made key, then cleared.
    pub(crate) fn take_last_activated(&mut self) -> Option<(libc::pid_t, u32)> {
        self.last_activated.take()
    }

    /// Runs the canary when it has not run yet; refuses background delivery
    /// while the SkyLight SPI is missing or the canary has failed.
    fn ensure_background_ready(&mut self) -> CoreResult<()> {
        match self.canary {
            canary::CanaryState::Off | canary::CanaryState::Passed => crate::skylight::require_spi(),
            canary::CanaryState::Failed => Err(DesktopError::background_unavailable(format!(
                "{CANARY_STOP_REASON}: the SkyLight receipt canary failed, so background window \
                 input is disabled until the session resumes it",
            ))),
            canary::CanaryState::Pending => canary::run(self).map(|_| ()),
        }
    }

    /// Posts the release of every key and button still held, through the route
    /// it was pressed on, and reports the first failure without stopping.
    pub(crate) fn release_all(&mut self) -> CoreResult<()> {
        let mut first_error = None;
        for key in self.held.take_keys() {
            let release = keys::post_key(
                &self.source,
                &mut self.held,
                key.code,
                key.text.as_deref(),
                false,
                core_graphics::event::CGEventFlags::CGEventFlagNull,
                key.route,
            );
            if let Err(error) = release {
                first_error.get_or_insert(error);
            }
        }
        for button in self.held.take_buttons() {
            if let Err(error) = global::release_button(&self.source, &button) {
                first_error.get_or_insert(error);
            }
        }
        first_error.map_or(Ok(()), Err)
    }
}

fn resolve_window(capture: &MacCapture, id: &str) -> CoreResult<DesktopWindow> {
    capture
        .windows()?
        .into_iter()
        .find(|window| window.id == id)
        .ok_or_else(|| {
            DesktopError::window_not_found(format!(
                "window '{id}' was not found; it may be closed or minimized"
            ))
        })
}

fn window_identity(window: &DesktopWindow) -> CoreResult<(libc::pid_t, u32)> {
    let pid = window.pid.ok_or_else(|| {
        DesktopError::input_failed(format!("window {} has no owning process id", window.id))
    })?;
    let pid = i32::try_from(pid)
        .map_err(|_| DesktopError::input_failed(format!("window {} has an invalid process id", window.id)))?;
    let wid = window
        .id
        .parse::<u32>()
        .map_err(|_| DesktopError::invalid_target(format!("invalid macOS window id '{}'", window.id)))?;
    Ok((pid, wid))
}
