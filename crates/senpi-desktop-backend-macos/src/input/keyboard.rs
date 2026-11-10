//! Keyboard input for a target: text typed into the desktop or a window,
//! text for a remote screen's layout keys, and key chords (moved out of
//! `input/mod.rs` unchanged).

use objc2_application_services::AXUIElement;
use senpi_desktop_core::backend::{DeliveryMode, ElementDelivery};
use senpi_desktop_core::error::CoreResult;
use senpi_desktop_core::keys::KeyName;
use senpi_desktop_core::protocol_results::AxInputMethod;
use senpi_desktop_core::types::{DesktopWindow, Target};

use super::held::KeyRoute;
use super::key_front::EntryFront;
use super::key_window::KeyWindow;
use super::{chord, element, guard, keymap, keys, remote, resolve_window, window_identity, MacInput};
use crate::capture::MacCapture;
use crate::skylight;

impl MacInput {
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
                let entry_front = EntryFront::now();
                let window = resolve_window(capture, id)?;
                self.type_window(&window, text, mode, entry_front, check_stop, delivered)
            }
        }
    }

    /// Text for `window`, once [`Self::type_text_interruptible`] resolved it;
    /// `entry_front` was read before that ([`KeyWindow`]).
    pub(super) fn type_window(
        &mut self,
        window: &DesktopWindow,
        text: &str,
        mode: DeliveryMode,
        entry_front: EntryFront,
        check_stop: &dyn Fn() -> CoreResult<()>,
        delivered: &mut dyn FnMut(),
    ) -> CoreResult<()> {
        let (pid, wid) = window_identity(window)?;
        // A remote screen (Screen Sharing, iPhone Mirroring) forwards key
        // codes and drops the Unicode text: its text goes out as the keys
        // of the user's layout, mapped in full before anything is posted.
        if let Some(remote) = remote::remote_screen(pid) {
            return self.type_remote(window, pid, wid, text, remote, mode, entry_front, check_stop, delivered, None).map(|_| ());
        }
        match mode {
            DeliveryMode::Background => skylight::reporting_partial(|| {
                self.type_window_background(window, (pid, wid), text, entry_front, check_stop, delivered)
            }),
            DeliveryMode::Foreground => skylight::with_foreground(pid, || {
                crate::ax::prepare_foreground_input(window)?;
                keys::type_text_interruptible(
                    &self.source, &mut self.held, text, KeyRoute::Global, check_stop, delivered,
                )
            }),
        }
    }

    /// Types `text` into `window`, a remote screen: every character is mapped
    /// to a key of the current layout first (an unmappable one refuses with
    /// nothing sent). In the background, Screen Sharing takes modifiers from
    /// the physical keyboard, so text that needs Shift or Option is refused
    /// before the first key and a modifier the user holds stops the keys; in
    /// the foreground the keys go out as bare transitions at the HID tap, each
    /// press checked against the front window. `element`, when given, must
    /// hold focus before the keys ([`element::element_keys`]). `entry_front`
    /// was read as the input began ([`KeyWindow`]).
    #[expect(clippy::too_many_arguments, reason = "the typing call's own arguments plus the remote classification")]
    pub(crate) fn type_remote(
        &mut self,
        window: &DesktopWindow,
        pid: libc::pid_t,
        wid: u32,
        text: &str,
        remote: remote::RemoteScreen,
        mode: DeliveryMode,
        entry_front: EntryFront,
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
                let target = KeyWindow::prepare(&this.source, window, (pid, wid), entry_front)?;
                this.last_activated = Some((pid, wid));
                let mut before_press = || {
                    check_stop()?;
                    target.check()?;
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
                let entry_front = EntryFront::now();
                let window = resolve_window(capture, id)?;
                self.chord_window(&window, keys, mode, entry_front, check_stop)
            }
        }
    }

    /// A key chord for `window`, once [`Self::key_chord`] resolved it;
    /// `entry_front` was read before that ([`KeyWindow`]).
    pub(super) fn chord_window(
        &mut self,
        window: &DesktopWindow,
        keys: &[KeyName],
        mode: DeliveryMode,
        entry_front: EntryFront,
        check_stop: &dyn Fn() -> CoreResult<()>,
    ) -> CoreResult<()> {
        let (pid, wid) = window_identity(window)?;
        match mode {
            DeliveryMode::Background => self.background(|this| {
                guard::guard(window, "keyboard", None)?;
                let target = KeyWindow::prepare(&this.source, window, (pid, wid), entry_front)?;
                this.last_activated = Some((pid, wid));
                let check = || check_stop().and_then(|()| target.check());
                chord::chord(&this.source, &mut this.held, keys, KeyRoute::Process(pid), &check)
            }),
            DeliveryMode::Foreground => skylight::with_foreground(pid, || {
                crate::ax::prepare_foreground_input(window)?;
                chord::chord(&self.source, &mut self.held, keys, KeyRoute::Global, check_stop)
            }),
        }
    }
}
