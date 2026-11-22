//! Gate 4: the effective target. A single target runs the Target stage; a multi-point request
//! runs Target, Scope and the reservation against EVERY point before the button goes down, and
//! one refused point refuses the whole call `InvalidTarget{drag_destination}` naming the point
//! and the refusing stage's own refusal.

use omo_computer_core::backend::Refusal;

use super::facts::{Identity, PointTarget, Resolution, VerbKind};
use super::verdicts::{ConsentRefusal, LeaseRefusal, TargetRefusal};
use super::{DragPoint, Gate, GateRefusal, Tables};

/// The Target stage on one resolution.
fn identity_refusal(
    verb: VerbKind,
    resolution: &Resolution,
    tables: &Tables<'_>,
) -> Option<TargetRefusal> {
    match resolution {
        Resolution::Desktop => None,
        Resolution::Unreadable => Some(match verb {
            VerbKind::Keyboard => TargetRefusal::FocusUnknown,
            VerbKind::Pointer | VerbKind::AppsQuit => TargetRefusal::TargetUnknown,
        }),
        Resolution::Window(identity) => window_refusal(verb, identity, tables),
    }
}

fn window_refusal(
    verb: VerbKind,
    identity: &Identity,
    tables: &Tables<'_>,
) -> Option<TargetRefusal> {
    let quit = verb == VerbKind::AppsQuit;
    if tables.self_set.contains(identity) {
        return Some(if quit {
            TargetRefusal::ProtectedProcess
        } else {
            TargetRefusal::SelfTarget
        });
    }
    if quit {
        return tables
            .protected
            .is_protected_process(identity)
            .then_some(TargetRefusal::ProtectedProcess);
    }
    tables
        .protected
        .is_protected_surface(identity, true)
        .then_some(TargetRefusal::ProtectedSurface)
}

/// The denied-app rule of the Scope stage on one resolution.
pub(super) fn denied_app(resolution: &Resolution, tables: &Tables<'_>) -> Option<ConsentRefusal> {
    match resolution {
        Resolution::Window(identity) if tables.is_denied_app(identity) => {
            Some(ConsentRefusal::DeniedApp)
        }
        _ => None,
    }
}

fn point_refusal(verb: VerbKind, target: &PointTarget, tables: &Tables<'_>) -> Option<Refusal> {
    identity_refusal(verb, &target.resolution, tables)
        .map(TargetRefusal::refusal)
        .or_else(|| denied_app(&target.resolution, tables).map(ConsentRefusal::refusal))
        .or_else(|| {
            target
                .reserved_by_other
                .then(|| LeaseRefusal::Window.refusal())
        })
}

/// # Errors
/// The first refusal of the Target stage, or `drag_destination` for a multi-point request.
pub(super) fn check(
    verb: VerbKind,
    targets: &[PointTarget],
    tables: &Tables<'_>,
) -> Result<(), GateRefusal> {
    let refuse = |refusal: TargetRefusal| GateRefusal::new(Gate::Target, refusal.refusal());
    match targets {
        [] => Err(refuse(match verb {
            VerbKind::Keyboard => TargetRefusal::FocusUnknown,
            VerbKind::Pointer | VerbKind::AppsQuit => TargetRefusal::TargetUnknown,
        })),
        [one] => identity_refusal(verb, &one.resolution, tables).map_or(Ok(()), |r| Err(refuse(r))),
        many => {
            for target in many {
                if let Some(inner) = point_refusal(verb, target, tables) {
                    let mut refused = refuse(TargetRefusal::DragDestination);
                    refused.drag = Some(DragPoint {
                        point: target.point,
                        inner,
                    });
                    return Err(refused);
                }
            }
            Ok(())
        }
    }
}
