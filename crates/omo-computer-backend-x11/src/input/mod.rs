//! Row 49: X11 input. The session posts a foreground input only while it holds the foreground
//! lease (`Route::ForegroundHid`); that route alone reaches XTEST. A background route reaches
//! `XSendEvent` to a window whose toolkit evidence admits it, or a typed refusal with nothing
//! sent. Every call runs inside [`Call`], whose drop - on success, error or panic - releases the
//! strokes the call pressed and restores a remapped scratch keycode; dropping the input releases
//! every key and button the engine still holds, warping to a button's press origin first.

pub mod background;
pub mod connection;
mod connection_events;
mod connection_keyboard;
mod connection_wm;
mod enter_guard;
#[cfg(test)]
pub(crate) mod fake;
pub mod holds;
pub mod keys;
pub mod live;
pub mod server;
pub mod xtest;

#[cfg(test)]
mod live_tests;
#[cfg(test)]
mod live_x;
#[cfg(test)]
mod route_tests;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod wiring_tests;

use std::collections::BTreeMap;
use std::ops::{Deref, DerefMut};

use omo_computer_core::backend::{BackendResult, Delivered, InputEvent, Refusal, Route};
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::params::Point;
use omo_computer_core::routes::RouteTable;
use omo_computer_core::settings::SendOnEnterRule;

use crate::release_helper::Note;
use holds::Ledger;
use server::{is_down, FakeInput, InputServer, XError};

/// The settings input reads at `session.open`.
#[derive(Debug, Clone, Default)]
pub struct InputSettings {
    /// `computer.x11_keymap_remap`: type a grapheme outside the active group through a scratch
    /// keycode instead of refusing it.
    pub keymap_remap: bool,
    /// `computer.send_on_enter`: the `WM_CLASS` keys whose composers send on Return.
    pub send_on_enter: BTreeMap<String, SendOnEnterRule>,
    /// Row 27's route table (seed plus `computer.toolkit_routes`).
    pub routes: RouteTable,
}

/// The scratch keycode a remap borrowed, with the keysyms it had.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Scratch {
    pub code: u8,
    pub original: Vec<u32>,
}

/// The AT-SPI role of the focused element (`entry`, `text`, `document text`), when known.
pub type FocusedRole = Box<dyn FnMut() -> Option<String> + Send>;

pub struct X11Input<S: InputServer = Box<dyn InputServer>> {
    pub(crate) server: S,
    pub(crate) ledger: Ledger,
    pub(crate) scratch: Option<Scratch>,
    pub(crate) settings: InputSettings,
    pub(crate) focused_role: FocusedRole,
    /// Where the last background pointer move aimed; nothing moves the real pointer.
    pub(crate) background_at: Option<(i16, i16)>,
}

impl<S: InputServer> X11Input<S> {
    #[must_use]
    pub fn new(server: S, settings: InputSettings) -> Self {
        Self {
            server,
            ledger: Ledger::default(),
            scratch: None,
            settings,
            focused_role: Box::new(|| None),
            background_at: None,
        }
    }

    #[must_use]
    pub fn with_focused_role(mut self, role: FocusedRole) -> Self {
        self.focused_role = role;
        self
    }

    /// Writes every engine-owned hold to `witness` (the release helper's pipe) before it is
    /// pressed, so a dead engine's holds are released by the helper.
    #[must_use]
    pub fn with_witness(mut self, witness: Box<dyn std::io::Write + Send>) -> Self {
        self.ledger.witness = Some(witness);
        self
    }

    /// Posts one event on `route`.
    ///
    /// # Errors
    /// A typed refusal with nothing sent, or `InputFailed` when a request failed (the call's
    /// strokes are released and any remap restored before it returns).
    pub fn post(&mut self, event: &InputEvent, route: Route) -> BackendResult<Delivered> {
        let mut call = Call(self);
        match route {
            Route::ForegroundHid => call.foreground(event),
            Route::BackgroundWindow | Route::BackgroundPid => call.background(event),
            Route::Ax => Err(Refusal::new(
                EngineCode::AxUnsupported,
                Reason::PerformUnsupported,
            )),
        }
    }

    /// Whether a release helper witnesses the holds (`capabilities().release_helper`).
    #[must_use]
    pub fn release_helper_live(&self) -> bool {
        self.ledger.witness.is_some()
    }

    /// The pointer's root point, read with `QueryPointer`: nothing is posted.
    #[must_use]
    pub fn pointer(&self) -> Option<Point> {
        let (x, y) = self.server.pointer().map_err(|error| logged(&error)).ok()?;
        Some(Point {
            x: f64::from(x),
            y: f64::from(y),
        })
    }

    /// The keys down now that the engine does not hold, by name.
    #[must_use]
    pub fn user_held_keys(&self) -> Vec<String> {
        let (Ok(bits), Ok(keyboard)) = (self.server.keys_down(), self.server.keyboard()) else {
            return Vec::new();
        };
        let mut names: Vec<String> = (0..=u8::MAX)
            .filter(|code| is_down(&bits, *code) && !self.ledger.engine_holds(*code))
            .filter_map(|code| {
                keyboard
                    .map
                    .keysym_at(keyboard.group, code)
                    .and_then(keys::name_of)
            })
            .collect();
        names.sort();
        names.dedup();
        names
    }

    /// Releases the strokes of the current call and restores the scratch keycode.
    fn end_call(&mut self) {
        self.release_keys(true);
        self.restore_scratch();
        self.flush_logged();
    }

    /// Releases the engine's keys of the scope; a key whose release failed stays in the ledger
    /// (and with the helper), so the next exit path tries it again.
    fn release_keys(&mut self, transient_only: bool) {
        for code in self.ledger.releases(transient_only) {
            if self
                .server
                .fake(FakeInput::Key { code, press: false })
                .map_err(|error| logged(&error))
                .is_ok()
            {
                self.ledger.key_up(code);
            }
        }
        self.ledger.forget_user_held(transient_only);
    }

    /// Releases every key and button the engine holds (warping to each button's press origin
    /// first) and restores the scratch keycode.
    pub fn release_all(&mut self) {
        for button in self.ledger.buttons() {
            let (x, y) = button.origin;
            let released = self.server.fake(FakeInput::Motion { x, y }).and_then(|()| {
                self.server.fake(FakeInput::Button {
                    detail: button.detail,
                    press: false,
                })
            });
            match released {
                Ok(()) => self.ledger.button_up(button.detail),
                Err(error) => logged(&error),
            }
        }
        self.release_keys(false);
        self.restore_scratch();
        self.flush_logged();
    }

    fn restore_scratch(&mut self) {
        if let Some(scratch) = self.scratch.take() {
            match self.server.remap(scratch.code, &scratch.original) {
                Ok(()) => self.ledger.note(&Note::Restored(scratch.code)),
                Err(error) => {
                    logged(&error);
                    self.scratch = Some(scratch);
                }
            }
        }
    }

    fn flush_logged(&self) {
        if let Err(error) = self.server.flush() {
            logged(&error);
        }
    }
}

impl<S: InputServer> Drop for X11Input<S> {
    fn drop(&mut self) {
        self.release_all();
    }
}

/// One `post`: dropping it ends the call on every exit path, unwinding included.
struct Call<'a, S: InputServer>(&'a mut X11Input<S>);

impl<S: InputServer> Deref for Call<'_, S> {
    type Target = X11Input<S>;
    fn deref(&self) -> &Self::Target {
        self.0
    }
}

impl<S: InputServer> DerefMut for Call<'_, S> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        self.0
    }
}

impl<S: InputServer> Drop for Call<'_, S> {
    fn drop(&mut self) {
        self.0.end_call();
    }
}

/// A failed request: logged once here, answered `InputFailed`.
pub(crate) fn failed(error: &XError) -> Refusal {
    logged(error);
    Refusal::bare(EngineCode::InputFailed)
}

fn logged(error: &XError) {
    eprintln!("omo-computer-backend-x11: input request failed: {error}");
}

/// A root point of the signed 16-bit protocol.
///
/// # Errors
/// `InvalidCoordinateFrame{outside_frame}` for a value outside it.
pub(crate) fn root_point(point: Point) -> Result<(i16, i16), Refusal> {
    let axis = |value: f64| {
        let rounded = value.round();
        // In range and integral (NaN fails the comparison): the cast is exact.
        let exact = rounded as i16;
        (rounded >= f64::from(i16::MIN) && rounded <= f64::from(i16::MAX))
            .then_some(exact)
            .ok_or(Refusal::new(
                EngineCode::InvalidCoordinateFrame,
                Reason::OutsideFrame,
            ))
    };
    Ok((axis(point.x)?, axis(point.y)?))
}

pub(crate) const fn one() -> Delivered {
    Delivered { count: 1, of: 1 }
}
