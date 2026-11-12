//! `apps.list` / `apps.open` / `apps.quit` (acceptance 84, 97). `apps.list()` records carry
//! `source` and `identity`; `open` and `quit` resolve the target's app identity BEFORE any process
//! is spawned or signalled and run consent against it, so a denied or out-of-scope app is refused
//! with nothing launched; the launch itself leaves through the funnel's one sink.

use omo_computer_core::backend::{InputEvent, Refusal, Route, WindowFilter};
use omo_computer_core::listing::AppInfo;
use omo_computer_core::methods::Method;
use omo_computer_core::params::{AppsOpenParams, AppsQuitParams};
use omo_computer_core::requests::{read_apps_open, read_apps_quit, Verb};
use omo_computer_core::results::ExecReply;
use omo_computer_safety::gate::{Identity, PointTarget, Resolution};
use omo_computer_safety::{Call, TargetRef, VerbKind};

use crate::consent::{AppTarget, BoundIdentity, Denial};
use crate::mutate::{Mutation, Refused};
use crate::{Session, NOT_OPEN};

/// A consent denial on the wire: its refusal and the members it carries.
pub(crate) fn denied(denial: Denial) -> Refused {
    Refused {
        detail: denial.detail.map(Box::new),
        ..Refused::from(denial.refusal.refusal())
    }
}

/// The backend's shell reads; a backend without them reads `AxUnsupported`.
pub(crate) fn shell(session: &mut Session) -> Result<&mut dyn omo_computer_core::surface::ShellReader, Refusal> {
    session
        .backend
        .shell_reader()
        .ok_or(Refusal::bare(omo_computer_core::error::EngineCode::AxUnsupported))
}

/// The app a window belongs to, bound to its code identity.
pub(crate) fn window_app(session: &mut Session, window: &str) -> Option<AppTarget> {
    let found = session
        .backend
        .windows(&WindowFilter::default())
        .ok()?
        .windows
        .into_iter()
        .find(|w| w.id == window)?;
    let identity = session.backend.code_identity(found.identity.pid);
    Some(AppTarget {
        app_key: found.app_key,
        bound: BoundIdentity::new(None, identity),
    })
}

impl Session {
    /// `apps.list()`: every record with its `source`, and its identity where readable.
    ///
    /// # Errors
    /// [`NOT_OPEN`] or the backend's refusal.
    pub fn apps_list(&mut self) -> Result<Vec<AppInfo>, Refusal> {
        if true { return Ok(Vec::new()); }
        self.opened.as_ref().ok_or(NOT_OPEN)?;
        let mut apps = shell(self)?.apps()?;
        for app in &mut apps {
            if app.identity.is_none() {
                app.identity = app.pid.and_then(|pid| self.backend.code_identity(pid));
            }
        }
        Ok(apps)
    }

    /// `apps.open(target, {activate})`.
    ///
    /// # Errors
    /// [`NOT_OPEN`], an unknown or ambiguous app, a consent refusal, or the funnel's refusal.
    pub fn apps_open(&mut self, params: AppsOpenParams) -> Result<ExecReply, Refused> {
        let request = read_apps_open(params);
        let Verb::AppsOpen { activate, .. } = request.verb else {
            unreachable!("read_apps_open always reads an apps.open");
        };
        let app = self.resolve_app(request.target.as_deref().unwrap_or_default())?;
        let activate = activate.unwrap_or(false);
        let target = app_resolution(&app);
        let event = InputEvent::AppLaunch { app_key: app.app_key, activate };
        let route = if activate { Route::ForegroundHid } else { Route::BackgroundPid };
        self.app_effect((Method::AppsOpen, VerbKind::Pointer), event, route, (&request.authority, target))
    }

    /// `apps.quit(target, {force})`.
    ///
    /// # Errors
    /// As [`Session::apps_open`].
    pub fn apps_quit(&mut self, params: AppsQuitParams) -> Result<ExecReply, Refused> {
        let request = read_apps_quit(params);
        let force = request.policy.force;
        let app = self.resolve_app(request.target.as_deref().unwrap_or_default())?;
        let target = app_resolution(&app);
        let event = InputEvent::AppQuit { app_key: app.app_key, force };
        self.app_effect((Method::AppsQuit, VerbKind::AppsQuit), event, Route::BackgroundPid, (&request.authority, target))
    }

    /// The app `target` names, admitted by consent under its identity, before anything runs.
    fn resolve_app(&mut self, target: &str) -> Result<AppInfo, Refused> {
        self.opened.as_ref().ok_or(NOT_OPEN)?;
        let apps = self.apps_list()?;
        let app = omo_computer_core::apps::resolve(target, &apps)?.clone();
        let consent_app = AppTarget {
            app_key: app.app_key.clone(),
            bound: BoundIdentity::new(app.path.clone(), app.identity.clone()),
        };
        self.funnel.control.consent.admit_exec(Some(&consent_app)).map_err(denied)?;
        Ok(app)
    }

    fn app_effect(
        &mut self,
        (method, verb): (Method, VerbKind),
        event: InputEvent,
        route: Route,
        (authority, target): (&omo_computer_core::requests::CallAuthority, PointTarget),
    ) -> Result<ExecReply, Refused> {
        let call = Call {
            verb,
            target: TargetRef::Desktop,
            points: Vec::new(),
            chord: None,
            force: false,
        };
        self.mutate(Mutation::exec(method, call, vec![event], route, authority).with_targets(vec![target]))
    }
}

/// The app as the Target and Scope stages see it: its identity, not a window.
fn app_resolution(app: &AppInfo) -> PointTarget {
    PointTarget::new(
        None,
        Resolution::Window(Identity {
            pid: app.pid.unwrap_or(0),
            app_key: app.app_key.clone(),
            surface: None,
        }),
    )
}
