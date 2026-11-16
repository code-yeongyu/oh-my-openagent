//! `apps.quit` (row 24): the app resolves to one of its windows, whose process identity the gate
//! checks (the self set and the protected table answer `ProtectedProcess`, force never overrides);
//! the quit is `confirmed` only when no window of the app is listed afterwards.

use omo_computer_core::backend::{Refusal, Route, WindowFilter};
use omo_computer_core::error::EngineCode;
use omo_computer_core::methods::Method;
use omo_computer_core::params::AppsQuitParams;
use omo_computer_core::requests::CallAuthority;
use omo_computer_core::results::ExecReply;
use omo_computer_safety::{Call, TargetRef, VerbKind};

use crate::mutate::{Mutation, Refused};
use crate::Session;

impl Session {
    /// `apps.quit`.
    ///
    /// # Errors
    /// `InvalidTarget` for an app with no window, or the gate's / funnel's refusal.
    pub fn apps_quit(&mut self, params: AppsQuitParams) -> Result<ExecReply, Refused> {
        let window = self
            .backend
            .windows(&WindowFilter::default())
            .ok()
            .and_then(|list| list.windows.into_iter().find(|w| w.app == params.target || w.app_key == params.target))
            .ok_or_else(|| Refused::from(Refusal::bare(EngineCode::InvalidTarget)))?;
        let authority = CallAuthority { call_id: params.call_id.clone(), run_generation: params.run_generation };
        let call = Call { verb: VerbKind::AppsQuit, target: TargetRef::read(Some(&window.id)), points: Vec::new(), chord: None, force: false };
        let write = super::Write::Quit { app: window.app.clone() };
        self.mutate(Mutation::exec(Method::AppsQuit, call, Vec::new(), Route::BackgroundWindow, &authority).with_write(write))
    }
}
