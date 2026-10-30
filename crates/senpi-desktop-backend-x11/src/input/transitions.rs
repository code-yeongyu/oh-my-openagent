//! Held-state transitions on XTEST and per-window event routes.

use super::held::{HeldButton, HeldKey, Route};
use super::keys::Stroke;
use super::server::{FakeInput, SentEvent};
use super::{InputServer, X11Input};
use senpi_desktop_core::error::CoreResult;

impl<S: InputServer> X11Input<S> {
    /// The single key-event emitter: a press is recorded as held before it
    /// is sent, a release forgotten only once it was sent.
    pub(super) fn key(
        &mut self,
        route: Route,
        stroke: Stroke,
        press: bool,
        state: u16,
    ) -> CoreResult<()> {
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
    pub(super) fn button(&mut self, button: HeldButton, press: bool, state: u16) -> CoreResult<()> {
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
