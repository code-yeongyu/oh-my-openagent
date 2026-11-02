//! Quartz input: CGEvent posting for the global desktop and per-window
//! SkyLight delivery, held-state tracking for `release_all`, and the SkyLight
//! receipt canary. The `Backend` wiring lives in [`crate::backend`].

mod background;
mod canary;
mod cgevent;
mod chord;
mod element;
mod global;
mod guard;
mod held;
mod keymap;
mod holds;
mod keys;
mod menu_key;
mod post;
mod remote;

pub(crate) use keymap::run_helper as run_keymap_helper;
mod release;
mod user_monitor;

#[cfg(test)]
mod tests;

#[cfg(test)]
mod element_tests;

#[cfg(test)]
mod live;

use core_graphics::event_source::CGEventSource;
use objc2_application_services::AXUIElement;
use senpi_desktop_core::backend::{DeliveryMode, ElementDelivery, PointerEvent};
use senpi_desktop_core::protocol_results::AxInputMethod;
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::keys::KeyName;
use senpi_desktop_core::types::{DesktopWindow, Target};

use crate::capture::MacCapture;
use crate::skylight;
use held::{Held, KeyRoute};

pub(crate) use self::canary::CANARY_STOP_REASON;
pub use self::canary::{CanaryMode, CanaryResult};
pub(crate) use self::cgevent::{modifier_flags, mouse_event, probe_event};
pub(crate) use self::keys::{key_code, update_modifier};
pub(crate) use self::user_monitor::UserInputWatch;
pub(crate) use self::release::post_helper_release;

pub(crate) struct MacInput {
    source: CGEventSource,
    held: Held,
    canary: canary::CanaryState,
    overlay: crate::overlay::Overlay,
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
            overlay: crate::overlay::Overlay::default(),
            last_activated: None,
        })
    }

    pub(crate) fn with_overlay(mut self, overlay: crate::overlay::Overlay) -> Self {
        self.overlay = overlay;
        self
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
        let _request = self.held.request();
        match target {
            Target::Desktop | Target::Display(_) => global::pointer(&self.source, &mut self.held, event, &self.overlay),
            Target::Window(id) => {
                let window = resolve_window(capture, id)?;
                let (pid, wid) = window_identity(&window)?;
                match mode {
                    DeliveryMode::Background => self.background(|this| {
                        guard::guard(
                            &window,
                            guard::pointer_kind(&event),
                            guard::pointer_button(&event),
                        )?;
                        if !window.focused {
                            skylight::activate_without_raise(pid, wid)?;
                            this.last_activated = Some((pid, wid));
                        }
                        background::pointer(&this.source, &mut this.held, pid, wid, &window, event, &this.overlay)
                    }),
                    DeliveryMode::Foreground => skylight::with_foreground(pid, || {
                        crate::ax::prepare_foreground_input(&window)?;
                        crate::ax::ensure_points_owned(&window, pid, wid, &event)?;
                        global::pointer(&self.source, &mut self.held, event, &self.overlay)
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
        self.type_text_interruptible(target, text, mode, capture, &|| Ok(()), &mut || {})
    }

    pub(crate) fn type_text_interruptible(
        &mut self,
        target: &Target,
        text: &str,
        mode: DeliveryMode,
        capture: &MacCapture,
        check_stop: &dyn Fn() -> CoreResult<()>,
        delivered: &mut dyn FnMut(),
    ) -> CoreResult<()> {
        let _request = self.held.request();
        match target {
            Target::Desktop | Target::Display(_) => keys::type_text_interruptible(
                &self.source, &mut self.held, text, KeyRoute::Global, check_stop, delivered,
            ),
            Target::Window(id) => {
                let window = resolve_window(capture, id)?;
                let (pid, wid) = window_identity(&window)?;
                // A remote screen (Screen Sharing, iPhone Mirroring) forwards key
                // codes and drops the Unicode text: its text goes out as the keys
                // of the user's layout, mapped in full before anything is posted.
                if let Some(remote) = remote::remote_screen(pid) {
                    return self.type_remote(&window, pid, wid, text, remote, mode, capture, check_stop, delivered, None).map(|_| ());
                }
                match mode {
                    DeliveryMode::Background => self.background(|this| {
                        guard::guard(&window, "keyboard", None)?;
                        guard::prepare_keys(&window, pid, wid, capture)?;
                        this.last_activated = Some((pid, wid));
                        keys::type_text_interruptible(
                            &this.source, &mut this.held, text, KeyRoute::Process(pid), check_stop, delivered,
                        )
                    }),
                    DeliveryMode::Foreground => skylight::with_foreground(pid, || {
                        crate::ax::prepare_foreground_input(&window)?;
                        keys::type_text_interruptible(
                            &self.source, &mut self.held, text, KeyRoute::Global, check_stop, delivered,
                        )
                    }),
                }
            }
        }
    }

    /// Types `text` into `window`, a remote screen: every character is mapped
    /// to a key of the current layout first (an unmappable one refuses with
    /// nothing sent). In the background, Screen Sharing takes modifiers from
    /// the physical keyboard, so text that needs Shift or Option is refused
    /// before the first key and a modifier the user holds stops the keys; in
    /// the foreground the keys go out as bare transitions at the HID tap, each
    /// press checked against the front window. `element`, when given, must
    /// hold focus before the keys ([`element::element_keys`]).
    #[expect(clippy::too_many_arguments, reason = "the typing call's own arguments plus the remote classification")]
    pub(crate) fn type_remote(
        &mut self,
        window: &DesktopWindow,
        pid: libc::pid_t,
        wid: u32,
        text: &str,
        remote: remote::RemoteScreen,
        mode: DeliveryMode,
        capture: &MacCapture,
        check_stop: &dyn Fn() -> CoreResult<()>,
        delivered: &mut dyn FnMut(),
        element: Option<&AXUIElement>,
    ) -> CoreResult<ElementDelivery> {
        // The whole text is mapped before anything is posted, so a character
        // the remote screen cannot receive refuses cleanly.
        let keys = remote::typed_keys(window, text, remote::remote_layout(window, keymap::layout_strokes)?)?;
        let gap = remote::key_gap(remote);
        match mode {
            DeliveryMode::Background => self.background(|this| {
                if remote == remote::RemoteScreen::KeyEvents {
                    let modified = remote::modified_text(&keys);
                    if !modified.is_empty() {
                        return Err(remote::keyboard_modifiers_refusal(window, &format!("type {}", modified.join(" "))));
                    }
                }
                let mut physical = (remote == remote::RemoteScreen::KeyEvents)
                    .then(|| remote::physical_modifier_check(window, remote::physical_flags));
                guard::guard(window, "keyboard", None)?;
                guard::prepare_keys(window, pid, wid, capture)?;
                this.last_activated = Some((pid, wid));
                let mut before_press = || {
                    check_stop()?;
                    physical.as_mut().map_or(Ok(()), |check| check())
                };
                let mut send = || {
                    keys::type_layout_keys(&this.source, &mut this.held, &keys, gap, KeyRoute::Process(pid), &mut before_press, delivered)
                };
                match element {
                    Some(element) => element::element_keys(pid, element, send),
                    None => send().map(|()| ElementDelivery::Delivered(AxInputMethod::Keys)),
                }
            }),
            DeliveryMode::Foreground => skylight::with_foreground(pid, || {
                crate::ax::prepare_foreground_input(window)?;
                // A remote screen may read modifiers from the keyboard state, which
                // only bare key transitions at the HID tap move. They post globally,
                // so every press first checks that the target still has focus.
                let transitions = remote::bare_transitions(&keys);
                let mut before_press = || {
                    check_stop()?;
                    crate::focus::require_front_window(pid, wid)
                };
                let mut send = || keys::post_bare_keys(&mut self.held, &transitions, gap, &mut before_press, delivered);
                match element {
                    Some(element) => element::element_keys(pid, element, send),
                    None => send().map(|()| ElementDelivery::Delivered(AxInputMethod::Keys)),
                }
            }),
        }
    }

    pub(crate) fn key_chord(
        &mut self,
        target: &Target,
        keys: &[KeyName],
        mode: DeliveryMode,
        capture: &MacCapture,
        check_stop: &dyn Fn() -> CoreResult<()>,
    ) -> CoreResult<()> {
        let _request = self.held.request();
        match target {
            Target::Desktop | Target::Display(_) => {
                chord::chord(&self.source, &mut self.held, keys, KeyRoute::Global, check_stop)
            }
            Target::Window(id) => {
                let window = resolve_window(capture, id)?;
                let (pid, wid) = window_identity(&window)?;
                match mode {
                    DeliveryMode::Background => self.background(|this| {
                        guard::guard(&window, "keyboard", None)?;
                        guard::prepare_keys(&window, pid, wid, capture)?;
                        this.last_activated = Some((pid, wid));
                        chord::chord(&this.source, &mut this.held, keys, KeyRoute::Process(pid), check_stop)
                    }),
                    DeliveryMode::Foreground => skylight::with_foreground(pid, || {
                        crate::ax::prepare_foreground_input(&window)?;
                        chord::chord(&self.source, &mut self.held, keys, KeyRoute::Global, check_stop)
                    }),
                }
            }
        }
    }

    /// The `(pid, wid)` a background action last made key, then cleared.
    pub(crate) fn take_last_activated(&mut self) -> Option<(libc::pid_t, u32)> {
        self.last_activated.take()
    }

    /// Runs one background action: readiness first (the canary's probe input
    /// goes to the engine's own window, never the target), then `action` under
    /// [`skylight::reporting_partial`], so a refusal after input of the call
    /// went out is `InputFailed` rather than a rerunnable
    /// `BackgroundUnavailable`.
    fn background<T>(&mut self, action: impl FnOnce(&mut Self) -> CoreResult<T>) -> CoreResult<T> {
        self.ensure_background_ready()?;
        skylight::reporting_partial(|| action(self))
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
