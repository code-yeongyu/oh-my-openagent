//! The marker's AUTHORITY reader, run before a new marker is written:
//!
//! - no marker: the call goes on;
//! - a completed marker of the same `callId`: `TransactionFailed{replayed}` with its receipt;
//! - a completed marker of another `callId`: the caller has read that reply and moved on, so
//!   the marker is cleared and the call goes on;
//! - an outstanding marker of another `callId` (or an unreadable one):
//!   `TransactionFailed{recovery_required, callId}`, the marker kept;
//! - an outstanding marker of the same `callId` (a re-drive after a crash, a restart or a
//!   lock pause): the act is refused, the interrupted send reads `delivery_uncertain/unsafe`,
//!   the callId is recorded as poisoned, and only then does the refusal's audit line clear
//!   the marker;
//! - a poisoned callId, checked first: refused the same way, every time. Nothing is ever resent.

use omo_computer_core::report::Disposition;

use super::{Funnel, Refused, RECOVERY_REQUIRED, REPLAYED};
use crate::audit::Warning;
use crate::marker::MarkerRead;

pub(super) enum Verdict {
    Proceed,
    /// `clear`: the marker goes once this refusal's audit line is written.
    Refuse {
        refused: Refused,
        clear: bool,
        warnings: Vec<Warning>,
    },
}

impl Funnel {
    pub(super) fn recover(&mut self, call_id: &str) -> Result<Verdict, Refused> {
        let (issuer, scope) = (self.binding.issuer.clone(), self.binding.scope.clone());
        if self.poisoned.contains(&issuer, &scope, call_id) {
            return Ok(Verdict::Refuse {
                refused: uncertain(call_id),
                clear: false,
                warnings: Vec::new(),
            });
        }
        let marker = match self.markers.read(&issuer, &scope) {
            MarkerRead::Absent => return Ok(Verdict::Proceed),
            MarkerRead::Unreadable => {
                return Ok(Verdict::Refuse {
                    refused: RECOVERY_REQUIRED.into(),
                    clear: false,
                    warnings: Vec::new(),
                })
            }
            MarkerRead::Found(marker) => marker,
        };
        let same = marker.binding.call_id == call_id;
        let refused = |refusal, interrupted| Refused {
            refusal,
            call_id: Some(marker.binding.call_id.clone()),
            receipt: None,
            interrupted,
            warning: None,
        };
        Ok(match (marker.receipt.as_ref(), same) {
            (Some(receipt), true) => Verdict::Refuse {
                refused: Refused {
                    receipt: Some(Box::new(receipt.reply.clone())),
                    ..refused(REPLAYED, None)
                },
                clear: false,
                warnings: Vec::new(),
            },
            (Some(_), false) => {
                if let Err(error) = self.markers.clear(&issuer, &scope) {
                    self.warn(format!("completed marker not cleared: {error}"));
                    return Err(super::MARKER_UNAVAILABLE.into());
                }
                Verdict::Proceed
            }
            (None, false) => Verdict::Refuse {
                refused: refused(RECOVERY_REQUIRED, None),
                clear: false,
                warnings: Vec::new(),
            },
            (None, true) => {
                let mut warnings = vec![Warning::MarkerRecovered];
                if marker.binding.generation != self.generation {
                    warnings.push(Warning::QuarantinedReply);
                }
                // The marker may go only once the callId stays refused without it; when the
                // record fails the marker stays (fail-closed) and the log says why.
                let clear = match self.poisoned.insert(&issuer, &scope, call_id) {
                    Ok(()) => true,
                    Err(error) => {
                        self.warn(format!(
                            "crashed callId {call_id} not poison-recorded, marker kept: {error}"
                        ));
                        false
                    }
                };
                Verdict::Refuse {
                    refused: uncertain(call_id),
                    clear,
                    warnings,
                }
            }
        })
    }
}

/// The answer to every re-drive of a crashed callId.
fn uncertain(call_id: &str) -> Refused {
    Refused {
        refusal: RECOVERY_REQUIRED,
        call_id: Some(call_id.to_owned()),
        receipt: None,
        interrupted: Some(Disposition::UNCERTAIN_UNSAFE),
        warning: None,
    }
}
