//! One content-free lifecycle pair per armed tap lifetime, including linger.

use std::sync::Arc;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DisarmReason {
    KeyboardReturned,
    UserChoice,
    TargetVisible,
    LingerExpired,
    Superseded,
    EngineExit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "event", rename_all_fields = "camelCase")]
pub enum AuditEvent {
    #[serde(rename = "keyReroute.arm")]
    Arm { arm_id: u64 },
    #[serde(rename = "keyReroute.disarm")]
    Disarm {
        arm_id: u64,
        /// Forwarded key events, including repeats and releases; never key data.
        moved_key_count: u64,
        reason: DisarmReason,
    },
}

pub type AuditSink = Arc<dyn Fn(AuditEvent) + Send + Sync>;

/// Moves with the tap worker, rather than ending when its input action returns.
pub struct AuditLease {
    id: u64,
    moved: u64,
    reason: DisarmReason,
    sink: AuditSink,
}

impl AuditLease {
    pub fn arm(id: u64, sink: AuditSink) -> Self {
        sink(AuditEvent::Arm { arm_id: id });
        Self {
            id,
            moved: 0,
            reason: DisarmReason::EngineExit,
            sink,
        }
    }

    pub fn moved_key(&mut self) {
        self.moved += 1;
    }

    pub fn disarm_reason(&mut self, reason: DisarmReason) {
        self.reason = reason;
    }
}

impl Drop for AuditLease {
    fn drop(&mut self) {
        (self.sink)(AuditEvent::Disarm {
            arm_id: self.id,
            moved_key_count: self.moved,
            reason: self.reason,
        });
    }
}
