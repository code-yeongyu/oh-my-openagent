//! X11 input: XTEST for the desktop and foreground delivery (behind the
//! `_NET_ACTIVE_WINDOW` focus guard), `XSendEvent` for background delivery
//! to toolkits that accept synthetic events, and held-state tracking for
//! `release_all`. Background input to a filtering toolkit is refused with
//! `BackgroundUnavailable`, never retried in the foreground.

mod connection;
mod focus;
mod held;
mod keys;
mod send_event;
mod server;
mod toolkit_filter;
mod xtest;

#[cfg(test)]
mod child_tests;
#[cfg(test)]
pub(crate) mod fake;
#[cfg(test)]
mod live_tests;
#[cfg(test)]
mod release_tests;
#[cfg(test)]
mod table_tests;
#[cfg(test)]
mod tests;

use senpi_desktop_core::backend::{DeliveryMode, PointerEvent};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::keys::KeyName;
use senpi_desktop_core::types::{DesktopPoint, Target};
use x11rb::protocol::xproto::Window;

pub use connection::X11InputConnection;
use held::{Held, HeldButton, HeldKey, Route};
use keys::Stroke;
pub use keys::{keysym_variants, Keymap};
pub use server::InputServer;
use server::{FakeInput, SentEvent, Spot};

pub struct X11Input<S = X11InputConnection> {
    server: S,
    held: Held,
}

impl X11Input<X11InputConnection> {
    /// # Errors
    /// `InputFailed` when the X server is unreachable or lacks XTEST 2.2.
    pub fn connect() -> CoreResult<Self> {
        X11InputConnection::connect().map(Self::with_server)
    }
}

impl<S: InputServer> X11Input<S> {
    pub fn with_server(server: S) -> Self {
        Self {
            server,
            held: Held::default(),
        }
    }

    #[cfg(test)]
    pub(crate) const fn server(&self) -> &S {
        &self.server
    }

    /// # Errors
    /// `WindowNotFound` for a malformed id, `BackgroundUnavailable` for a
    /// filtering toolkit, `InputFailed` when a request fails.
    pub fn pointer(&mut self, target: &Target, event: &PointerEvent, mode: DeliveryMode) -> CoreResult<()> {
        match (target, mode) {
            (Target::Desktop, _) => self.pointer_xtest(event),
            (Target::Window(id), DeliveryMode::Foreground) => {
                self.with_foreground(parse_window(id)?, |this| this.pointer_xtest(event))
            }
            (Target::Window(id), DeliveryMode::Background) => {
                let window = self.background_window(id, send_event::event_kind(event))?;
                self.pointer_send_event(window, event)
            }
        }
    }

    /// # Errors
    /// As [`Self::pointer`], plus `InvalidKey` for a character the keymap
    /// cannot type (checked before any key is sent).
    pub fn type_text(&mut self, target: &Target, text: &str, mode: DeliveryMode) -> CoreResult<()> {
        let strokes = text
            .chars()
            .map(|ch| self.server.keymap().strokes(KeyName::Char(ch)))
            .collect::<CoreResult<Vec<_>>>()?;
        self.deliver_keys(target, mode, "text", |this, route| {
            strokes.iter().try_for_each(|chord| this.chord(route, chord))
        })
    }

    /// # Errors
    /// As [`Self::type_text`].
    pub fn key_chord(&mut self, target: &Target, keys: &[KeyName], mode: DeliveryMode) -> CoreResult<()> {
        let mut strokes = Vec::with_capacity(keys.len());
        for &key in keys {
            strokes.extend(self.server.keymap().strokes(key)?);
        }
        self.deliver_keys(target, mode, "key", |this, route| this.chord(route, &strokes))
    }

    /// # Errors
    /// `WindowNotFound` for a malformed id; `InputFailed` when the window
    /// manager does not activate the window.
    pub fn raise_window(&mut self, id: &str) -> CoreResult<()> {
        self.activate(parse_window(id)?)
    }

    /// Releases every key and button still held, through the route it went
    /// down on; reports the first failure without stopping.
    ///
    /// # Errors
    /// The first release that failed; the rest were still attempted.
    pub fn release_all(&mut self) -> CoreResult<()> {
        let mut first_error = None;
        for key in self.held.keys() {
            if let Err(error) = self.key(
                key.route,
                Stroke {
                    code: key.code,
                    mask: 0,
                },
                false,
                0,
            ) {
                first_error.get_or_insert(error);
            }
        }
        for button in self.held.buttons() {
            if let Err(error) = self.button(button, false, 0) {
                first_error.get_or_insert(error);
            }
        }
        if let Err(error) = self.server.flush() {
            first_error.get_or_insert(error);
        }
        first_error.map_or(Ok(()), Err)
    }

    /// # Errors
    /// `InputFailed` when the pointer query fails.
    pub fn cursor_position(&self) -> CoreResult<DesktopPoint> {
        let (x, y) = self.server.pointer()?;
        Ok(DesktopPoint {
            x: f64::from(x),
            y: f64::from(y),
        })
    }

    /// # Errors
    /// `InvalidCoordinateFrame` outside the X11 range; `InputFailed` when
    /// the warp fails.
    pub fn warp_cursor(&self, point: DesktopPoint) -> CoreResult<()> {
        let (x, y) = xtest::point(point.x, point.y)?;
        self.server.warp(x, y)
    }

    /// Runs `deliver` on the route `target` and `mode` select.
    fn deliver_keys(
        &mut self,
        target: &Target,
        mode: DeliveryMode,
        kind: &str,
        deliver: impl FnOnce(&mut Self, Route) -> CoreResult<()>,
    ) -> CoreResult<()> {
        let result = match (target, mode) {
            (Target::Desktop, _) => deliver(self, Route::Xtest),
            (Target::Window(id), DeliveryMode::Foreground) => {
                self.with_foreground(parse_window(id)?, |this| deliver(this, Route::Xtest))
            }
            (Target::Window(id), DeliveryMode::Background) => {
                let window = self.background_window(id, kind)?;
                deliver(self, Route::Window(window))
            }
        };
        result.and_then(|()| self.server.flush())
    }

    /// The window of a background request, refused when its toolkit drops
    /// synthetic events.
    fn background_window(&self, id: &str, kind: &str) -> CoreResult<Window> {
        let window = parse_window(id)?;
        let class = self.server.wm_class(window).unwrap_or_default();
        match toolkit_filter::filtering_toolkit(&class) {
            Some(toolkit) => Err(toolkit_filter::background_unavailable(id, kind, toolkit, &class)),
            None => Ok(window),
        }
    }

    /// Presses `strokes` in order and releases them in reverse; each event
    /// carries the modifiers held before it. A failed press still releases
    /// what went down.
    fn chord(&mut self, route: Route, strokes: &[Stroke]) -> CoreResult<()> {
        let mut state = 0;
        let mut pressed = 0;
        let mut first_error = None;
        for &stroke in strokes {
            if let Err(error) = self.key(route, stroke, true, state) {
                first_error = Some(error);
                break;
            }
            pressed += 1;
            state |= stroke.mask;
        }
        for &stroke in strokes.iter().take(pressed).rev() {
            if let Err(error) = self.key(route, stroke, false, state) {
                first_error.get_or_insert(error);
            }
            state &= !stroke.mask;
        }
        first_error.map_or(Ok(()), Err)
    }

    /// The single key-event emitter: a press is recorded as held before it
    /// is sent, a release forgotten only once it was sent.
    fn key(&mut self, route: Route, stroke: Stroke, press: bool, state: u16) -> CoreResult<()> {
        let held = HeldKey {
            route,
            code: stroke.code,
        };
        if press {
            self.held.key_down(held);
        }
        match route {
            Route::Xtest => self.server.fake(FakeInput::Key {
                code: stroke.code,
                press,
            }),
            Route::Window(window) => self.server.send(
                window,
                SentEvent::Key {
                    code: stroke.code,
                    press,
                    state,
                },
            ),
        }?;
        if !press {
            self.held.key_up(held);
        }
        Ok(())
    }

    /// The single button-event emitter, with the same held-state rules.
    fn button(&mut self, button: HeldButton, press: bool, state: u16) -> CoreResult<()> {
        if press {
            self.held.button_down(button);
        }
        let HeldButton { route, detail, at } = button;
        match route {
            Route::Xtest => self.server.fake(FakeInput::Button { detail, press }),
            Route::Window(window) => self.server.send(
                window,
                SentEvent::Button {
                    detail,
                    press,
                    at,
                    state,
                },
            ),
        }?;
        if !press {
            self.held.button_up(route, detail);
        }
        Ok(())
    }
}

/// X11 window ids are this backend's own decimal XIDs.
fn parse_window(id: &str) -> CoreResult<Window> {
    id.parse::<Window>()
        .map_err(|_| DesktopError::window_not_found(format!("invalid X11 window id {id}")))
}

/// The root-coordinate spot of an XTEST event (window-local is unused).
const fn root_spot(x: i16, y: i16) -> Spot {
    Spot {
        root: (x, y),
        local: (x, y),
    }
}
