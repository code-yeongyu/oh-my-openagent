//! The background route: `XSendEvent` to one window, never XTEST, so it needs no lease and never
//! moves the user's pointer or focus. X returns no receipt for a sent event, so the route is
//! taken only for a client whose toolkit evidence says it dispatches synthetic events; every
//! other client is refused `BackgroundUnavailable` with its toolkit named and nothing sent.

use omo_computer_core::backend::{BackendResult, Delivered, InputEvent, Refusal};
use omo_computer_core::error::{EngineCode, Reason};

use super::keys::{self, plan, unresolvable, Step};
use super::server::{InputServer, SentEvent, Window};
use super::xtest::{button_detail, scroll_buttons};
use super::{failed, one, root_point, X11Input};
use crate::toolkit::{background_route, classify, route_class};

const SHIFT_MASK: u16 = 1;

impl<S: InputServer> X11Input<S> {
    pub(super) fn background(&mut self, event: &InputEvent) -> BackendResult<Delivered> {
        let delivered = match event {
            InputEvent::PointerMove(point) => {
                self.background_at = Some(root_point(*point)?);
                one()
            }
            InputEvent::Button { button, down } => {
                self.send_button(button_detail(*button), *down)?;
                one()
            }
            InputEvent::Scroll { dx, dy } => {
                let mut count = 0;
                for (detail, clicks) in scroll_buttons(*dx, *dy) {
                    for _ in 0..clicks {
                        self.send_button(detail, true)?;
                        self.send_button(detail, false)?;
                        count += 1;
                    }
                }
                Delivered { count, of: count }
            }
            InputEvent::Key { key, down } => self.send_key(key, *down)?,
            InputEvent::Text(text) => self.send_text(text)?,
            _ => return Err(Refusal::new(EngineCode::Internal, Reason::InputUnsupported)),
        };
        self.server.flush().map_err(|error| failed(&error))?;
        Ok(delivered)
    }

    /// Refuses `window` unless its client's toolkit takes synthetic events.
    fn admit(&self, window: Window) -> Result<(), Refusal> {
        let evidence = self.server.evidence(window).unwrap_or_default();
        let toolkit = classify(&evidence);
        background_route(
            toolkit,
            route_class(toolkit, &evidence.wm_class, &self.settings.routes),
        )
    }

    fn send_button(&self, detail: u8, press: bool) -> Result<(), Refusal> {
        let target_unknown = Refusal::new(EngineCode::BackgroundUnavailable, Reason::TargetUnknown);
        let at = self.background_at.ok_or(target_unknown.clone())?;
        let hit = self
            .server
            .hit(at.0, at.1)
            .map_err(|error| failed(&error))?
            .ok_or(target_unknown)?;
        self.admit(hit.client)?;
        let event = SentEvent::Button {
            detail,
            press,
            root: at,
            local: hit.local,
        };
        self.server
            .send(hit.deepest, event)
            .map_err(|error| failed(&error))
    }

    fn focus_window(&self) -> Result<Window, Refusal> {
        self.server.focus().map_err(|error| failed(&error))
    }

    fn send_key(&mut self, key: &str, down: bool) -> BackendResult<Delivered> {
        let name = omo_computer_core::keys::key_name(key)
            .map_err(|_| Refusal::new(EngineCode::InvalidKey, Reason::UnknownKey))?;
        let keysym =
            keys::named(&name).ok_or(Refusal::new(EngineCode::InvalidKey, Reason::UnknownKey))?;
        if down {
            self.guard_enter(&name)?;
        }
        let window = self.focus_window()?;
        self.admit(window)?;
        let keyboard = self.server.keyboard().map_err(|error| failed(&error))?;
        let (code, _) = keyboard
            .map
            .resolve(keyboard.group, keysym)
            .ok_or_else(|| unresolvable(keyboard.group, &name))?;
        self.server
            .send(
                window,
                SentEvent::Key {
                    code,
                    press: down,
                    state: 0,
                },
            )
            .map_err(|error| failed(&error))?;
        Ok(one())
    }

    /// Types `text` by sent key events in the active group; the scratch remap is a global
    /// keymap change, so the background route never takes it.
    fn send_text(&mut self, text: &str) -> BackendResult<Delivered> {
        self.guard_enter_text(text)?;
        let window = self.focus_window()?;
        self.admit(window)?;
        let keyboard = self.server.keyboard().map_err(|error| failed(&error))?;
        for step in plan(&keyboard.map, keyboard.group, text, false)? {
            if let Step::Key { code, shift } = step {
                let state = if shift { SHIFT_MASK } else { 0 };
                for press in [true, false] {
                    self.server
                        .send(window, SentEvent::Key { code, press, state })
                        .map_err(|error| failed(&error))?;
                }
            }
        }
        let count = u32::try_from(keys::graphemes(text).count()).unwrap_or(u32::MAX);
        Ok(Delivered { count, of: count })
    }
}
