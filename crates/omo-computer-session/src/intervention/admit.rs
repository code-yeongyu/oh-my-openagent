//! The admission of one exec around the safety gate: the gate first (latch and stop path
//! always precede everything), then the pause for a lock, a suspend or a user working in the
//! target, the gate again after any wait, then the session-state route policy and the
//! liveness of the target. Every refusal here happens before any OS call.

use omo_computer_core::backend::{Route, WindowFilter};
use omo_computer_core::intervention::Pause;
use omo_computer_safety::guard::StageVerdicts;
use omo_computer_safety::{Call, Gate, TargetRef};

use crate::liveness::{exited, unresponsive, WINDOW_NOT_FOUND};
use crate::mutate::Refused;
use crate::session_state::{route_refusal, sample};
use crate::Session;

/// An admitted exec: what it waited for, and the pid of its window target.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Admission {
    pub paused: Vec<Pause>,
    pub pid: Option<u32>,
}

/// A refused exec: the audit stage that refused it and the refusal.
#[derive(Debug, Clone, PartialEq)]
pub struct Blocked {
    pub stage: String,
    /// Boxed so the admission's error stays small (clippy result_large_err).
    pub refused: Box<Refused>,
}

const fn window_of<'a>(target: &TargetRef<'a>) -> Option<&'a str> {
    match target {
        TargetRef::Desktop => None,
        TargetRef::Window(id) => Some(id),
    }
}

impl Session {
    fn window_pid(&mut self, window: Option<&str>) -> Option<u32> {
        let window = window?;
        let listing = self.backend.windows(&WindowFilter::default()).ok()?;
        listing
            .windows
            .iter()
            .find(|info| info.id == window)
            .map(|info| info.identity.pid)
    }

    /// Admits `call` on `route`, pausing up to `ceiling_ms`.
    ///
    /// # Errors
    /// The first refusing stage, with nothing sent.
    pub(crate) fn admit_call(
        &mut self,
        call: &Call<'_>,
        route: Route,
        stages: StageVerdicts,
        ceiling_ms: Option<u64>,
    ) -> Result<Admission, Blocked> {
        let window = window_of(&call.target);
        let mut admitted = self.guard.admit_on_with(self.backend.as_mut(), call, stages.clone());
        let mut paused = Vec::new();
        let mut pid = None;
        let may_pause = admitted.as_ref().map_or_else(|r| r.gate == Gate::Lock, |_| true);
        if let Some(ceiling_ms) = ceiling_ms.filter(|_| may_pause) {
            pid = self.window_pid(window);
            match self.pause_admission(pid, ceiling_ms) {
                Ok(waited) => {
                    if !waited.is_empty() || admitted.is_err() {
                        admitted = self.guard.admit_on_with(self.backend.as_mut(), call, stages);
                    }
                    paused = waited;
                }
                Err(ended) => {
                    return Err(Blocked {
                        stage: "Pause".to_owned(),
                        refused: Box::new(Refused::from(ended.refusal).with_paused(ended.paused)),
                    })
                }
            }
        }
        if let Err(refused) = admitted {
            let crashed = refused.gate == Gate::Target
                && exited(self.backend.as_ref(), window).is_some();
            let refusal = if crashed { WINDOW_NOT_FOUND } else { refused.refusal };
            let mut out = Refused::from(refusal).with_paused(paused);
            // R54, R60b: a refused drag point names the point and the refusing stage's pair, its
            // engine code (`stageCode`) and that refusal's own reason (`stageReason`) when it has one.
            out.detail = refused.drag.filter(|_| !crashed).map(|drag| {
                let mut data = serde_json::json!({
                    "point": drag.point.map(|p| serde_json::json!({ "x": p.x, "y": p.y })),
                    "stageCode": drag.inner.code.wire(),
                });
                if let (Some(reason), Some(map)) = (drag.inner.reason, data.as_object_mut()) {
                    map.insert("stageReason".to_owned(), serde_json::json!(reason));
                }
                Box::new(data)
            });
            return Err(Blocked {
                stage: format!("{:?}", refused.gate),
                refused: Box::new(out),
            });
        }
        if let Some(refusal) = route_refusal(&sample(self.backend.as_ref()), route) {
            return Err(Blocked {
                stage: "Route".to_owned(),
                refused: Box::new(Refused::from(refusal).with_paused(paused)),
            });
        }
        if let Some((refusal, target)) = unresponsive(self.backend.as_ref(), window) {
            let mut refused = Refused::from(refusal).with_paused(paused);
            refused.stamps.target = Some(target);
            return Err(Blocked {
                stage: "Liveness".to_owned(),
                refused: Box::new(refused),
            });
        }
        if pid.is_none() {
            pid = self.window_pid(window);
        }
        Ok(Admission { paused, pid })
    }

    /// Object mode stamps the session state on a refusal; null mode carries no pause.
    pub(crate) fn stamp(&self, mut refused: Refused, object: bool) -> Refused {
        if object {
            refused.stamps.session = Some(sample(self.backend.as_ref()));
        } else {
            refused.stamps.paused.clear();
        }
        refused
    }
}
