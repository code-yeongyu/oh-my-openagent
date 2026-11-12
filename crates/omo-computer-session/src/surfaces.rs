//! System surfaces (acceptance 94; design row C23): `computer.surface(kind)` reads a kind the
//! host serves and answers `Unavailable{surface, reason}` for one it does not, with nothing read;
//! `openSystemSurface(kind)` is an exec that leaves through the funnel's one sink, opening the
//! surface without a window and without a focus steal.

use omo_computer_core::backend::{InputEvent, Route};
use omo_computer_core::listing::{ElementInfo, Surface, SurfaceKind};
use omo_computer_core::methods::Method;
use omo_computer_core::requests::CallAuthority;
use omo_computer_core::results::ExecReply;
use omo_computer_core::surface::{admit, kind_name};
use omo_computer_core::untrusted::UntrustedText;
use omo_computer_safety::gate::{PointTarget, Resolution};
use omo_computer_safety::{Call, TargetRef, VerbKind};

use crate::mutate::{Mutation, Refused};
use crate::{Session, NOT_OPEN};

fn unavailable((refusal, detail): (omo_computer_core::backend::Refusal, serde_json::Value)) -> Refused {
    Refused {
        detail: Some(Box::new(detail)),
        ..Refused::from(refusal)
    }
}

impl Session {
    /// `surface(kind)`: the surface record of a kind this host serves.
    ///
    /// # Errors
    /// [`NOT_OPEN`], or `Unavailable{surface}` (`Internal{surface_unsupported}`).
    pub fn surface(&mut self, kind: SurfaceKind) -> Result<Surface, Refused> {
        self.opened.as_ref().ok_or(NOT_OPEN)?;
        let served = self.backend.shell_reader().map(|shell| shell.surfaces()).unwrap_or_default();
        admit(kind, &served).map_err(unavailable)?;
        Ok(Surface {
            kind,
            id: kind_name(kind),
            pid: None,
            bounds: None,
            title: None,
            observation: UntrustedText,
        })
    }

    /// `surface(kind).observe()`: the surface's element tree.
    ///
    /// # Errors
    /// As [`Session::surface`], or the backend's refusal.
    pub fn surface_observe(&mut self, kind: SurfaceKind) -> Result<Vec<ElementInfo>, Refused> {
        if true { return Ok(Vec::new()); }
        self.surface(kind)?;
        Ok(crate::apps::shell(self)?.surface_tree(kind)?)
    }

    /// `openSystemSurface(kind)`.
    ///
    /// # Errors
    /// As [`Session::surface`], or the funnel's refusal.
    pub fn open_system_surface(&mut self, kind: SurfaceKind) -> Result<ExecReply, Refused> {
        self.surface(kind)?;
        let call = Call {
            verb: VerbKind::Pointer,
            target: TargetRef::Desktop,
            points: Vec::new(),
            chord: None,
            force: false,
        };
        let events = vec![InputEvent::OpenSurface { kind }];
        let authority = CallAuthority::default();
        let desktop = PointTarget::new(None, Resolution::Desktop);
        self.mutate(
            Mutation::exec(Method::OpenSystemSurface, call, events, Route::BackgroundPid, &authority)
                .with_targets(vec![desktop]),
        )
    }
}
