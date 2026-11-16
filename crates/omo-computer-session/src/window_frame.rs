//! Row 24's window-frame verbs (design row C8): `window.setFrame` reads the frame back and
//! judges it within 1 px per edge; a window whose position cannot be set answers
//! `WindowImmovable` with nothing sent; `window.restore` needs the foreground lease.

use omo_computer_core::backend::{Refusal, Route};
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::methods::Method;
use omo_computer_core::params::{WindowFrameParams, WindowParams};
use omo_computer_core::requests::CallAuthority;
use omo_computer_core::results::ExecReply;
use omo_computer_core::window_frame::FrameAsk;
use omo_computer_safety::{Call, TargetRef, VerbKind};

use crate::mutate::{Mutation, Refused};
use crate::value_verbs::Write;
use crate::Session;

fn window_call(window: &str) -> Call<'_> {
    Call { verb: VerbKind::Pointer, target: TargetRef::read(Some(window)), points: Vec::new(), chord: None, force: false }
}

impl Session {
    fn current_frame(&mut self, window: &str) -> Option<omo_computer_core::listing::Rect> {
        let list = self.backend.windows(&omo_computer_core::backend::WindowFilter::default()).ok()?;
        list.windows.into_iter().find(|w| w.id == window).map(|w| w.bounds)
    }

    /// `window.setFrame`.
    ///
    /// # Errors
    /// `WindowImmovable` (nothing sent) for a window whose position cannot be set, or the
    /// funnel's refusal.
    pub fn window_set_frame(&mut self, params: WindowFrameParams) -> Result<ExecReply, Refused> {
        let ask = FrameAsk { x: params.x, y: params.y, width: params.width, height: params.height };
        let moves = ask.x.is_some() || ask.y.is_some();
        if moves && self.backend.frame_settable(&params.target) == Some(false) {
            return Err(Refused::from(Refusal::new(EngineCode::InvalidTarget, Reason::WindowImmovable.wire())));
        }
        let current = self.current_frame(&params.target).ok_or_else(|| Refused::from(Refusal::bare(EngineCode::WindowNotFound)))?;
        let authority = CallAuthority { call_id: params.call_id.clone(), run_generation: params.run_generation };
        let write = Write::SetFrame { window: params.target.clone(), asked: ask.over(current) };
        self.mutate(Mutation::exec(Method::WindowSetFrame, window_call(&params.target), Vec::new(), Route::BackgroundWindow, &authority).with_write(write))
    }

    /// `window.minimize`.
    ///
    /// # Errors
    /// The funnel's refusal.
    pub fn window_minimize(&mut self, params: WindowParams) -> Result<ExecReply, Refused> {
        self.minimized(Method::WindowMinimize, params, true, Route::BackgroundWindow)
    }

    /// `window.restore`: brings the window back in front of the user, so it needs the
    /// foreground lease (`ControlRequired` without it).
    ///
    /// # Errors
    /// The funnel's refusal.
    pub fn window_restore(&mut self, params: WindowParams) -> Result<ExecReply, Refused> {
        self.minimized(Method::WindowRestore, params, false, Route::ForegroundHid)
    }

    fn minimized(&mut self, method: Method, params: WindowParams, minimize: bool, route: Route) -> Result<ExecReply, Refused> {
        let authority = CallAuthority { call_id: params.call_id.clone(), run_generation: params.run_generation };
        let write = Write::Minimized { window: params.target.clone(), minimize };
        self.mutate(Mutation::exec(method, window_call(&params.target), Vec::new(), route, &authority).with_write(write))
    }
}
