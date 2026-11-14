//! The audit event and the pre-input marker of one call, built once from the mutation so
//! both carry the same binding and the same redaction.

use omo_computer_core::backend::{Refusal, Route};
use omo_computer_core::report::Disposition;
use omo_computer_safety::TargetRef;

use super::{Funnel, Mutation};
use crate::audit::{
    self, rfc3339_ms, AuditEvent, DeliveredRecord, DeliveryKind, DispositionRecord, Gate,
    GateOutcome, Status, Tier, Warning,
};
use crate::marker::{MarkerBinding, PreInputMarker, MARKER_VERSION};

/// `expiresAt` is the issue time plus this; informational only.
const MARKER_EXPIRY_MS: u64 = 30_000;

pub(super) struct Record {
    pub(super) event: AuditEvent,
    pub(super) marker: PreInputMarker,
}

pub(super) fn target_name(target: &TargetRef<'_>) -> String {
    match target {
        TargetRef::Desktop => "desktop".to_owned(),
        TargetRef::Window(id) => format!("window:{id}"),
    }
}

pub(super) fn target_id<'a>(target: &TargetRef<'a>) -> Option<&'a str> {
    match target {
        TargetRef::Desktop => None,
        TargetRef::Window(id) => Some(id),
    }
}

const fn route_name(route: Route) -> &'static str {
    match route {
        Route::Ax => "ax",
        Route::BackgroundWindow => "background_window",
        Route::BackgroundPid => "background_pid",
        Route::ForegroundHid => "foreground_hid",
    }
}

impl Record {
    pub(super) fn new(
        funnel: &Funnel,
        mutation: &Mutation<'_>,
        call_id: &str,
        secure: bool,
    ) -> Self {
        let text = mutation
            .text
            .as_deref()
            .map(|text| audit::text(text, secure));
        let keys = audit::keys(&mutation.keys, secure);
        let text = text.or_else(|| keys.text.clone());
        let mut warnings = Vec::new();
        if secure && text.is_some() {
            warnings.push(Warning::RedactedSecure);
        }
        let target = target_name(&mutation.call.target);
        let action = mutation.method.spec().name.to_owned();
        let run_generation = mutation.run_generation.unwrap_or(0);
        let issued = audit::now_ms();
        let event = AuditEvent {
            session_id: funnel.session_id.clone(),
            run_id: run_generation.to_string(),
            call_id: call_id.to_owned(),
            issuer: funnel.binding.issuer.clone(),
            scope: funnel.binding.scope.clone(),
            action: action.clone(),
            target: target.clone(),
            delivery: match mutation.route {
                Route::ForegroundHid => DeliveryKind::Foreground,
                Route::Ax | Route::BackgroundWindow | Route::BackgroundPid => {
                    DeliveryKind::Background
                }
            },
            route: Some(route_name(mutation.route).to_owned()),
            tier: Tier::Exec,
            frame_id: mutation.frame_id.clone(),
            text: text.clone(),
            keys: keys.keys.clone(),
            marker_issued_at: Some(rfc3339_ms(issued)),
            warnings: warnings.clone(),
            ..AuditEvent::default()
        };
        let marker = PreInputMarker {
            v: MARKER_VERSION,
            binding: MarkerBinding {
                issuer: funnel.binding.issuer.clone(),
                scope: funnel.binding.scope.clone(),
                call_id: call_id.to_owned(),
                run_generation,
                generation: funnel.generation,
            },
            action,
            target,
            frame_id: mutation.frame_id.clone(),
            text,
            keys: keys.keys,
            warnings: if secure {
                vec!["redacted_secure".to_owned()]
            } else {
                Vec::new()
            },
            issued_at: rfc3339_ms(issued),
            expires_at: rfc3339_ms(issued + MARKER_EXPIRY_MS),
            receipt: None,
        };
        Self { event, marker }
    }

    /// The line of a call refused before anything was sent (`stage`: the gate row).
    pub(super) fn refused(&mut self, stage: Option<String>, refusal: &Refusal) {
        self.event.gate = Gate {
            outcome: GateOutcome::Refused,
            stage,
            code: Some(refusal.code.wire().to_owned()),
            reason: refusal.reason.map(str::to_owned),
        };
        self.event.status = match refusal.code.wire() {
            "Suspended" => Status::Suspended,
            _ => Status::Refused,
        };
        self.event.primary_error = Some(refusal.code.wire().to_owned());
        self.event.disposition = Some(record(Disposition::NOT_DELIVERED_SAFE));
        self.event.marker_issued_at = None;
    }

    /// The line of a call whose input went out (`failure`: a backend refusal mid-send).
    pub(super) fn sent(
        &mut self,
        count: u32,
        of: u32,
        disposition: Disposition,
        effect: &str,
        failure: Option<&Refusal>,
    ) {
        self.event.delivered = Some(DeliveredRecord { count, of });
        self.event.disposition = Some(record(disposition));
        self.event.effect = Some(effect.to_owned());
        if let Some(refusal) = failure {
            self.event.status = Status::Error;
            self.event.primary_error = Some(refusal.code.wire().to_owned());
        }
    }
}

fn record(disposition: Disposition) -> DispositionRecord {
    DispositionRecord {
        delivery: disposition.delivery().wire().to_owned(),
        retry: disposition.retry().wire().to_owned(),
    }
}
