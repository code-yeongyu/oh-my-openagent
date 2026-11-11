//! One writer's segment: `audit.meta`, the stamp of each line and its place in the chain;
//! and the lines the writer builds itself (the `rotation_anchor`, a truncated event).

use std::fs::File;
use std::io::{self, BufRead, BufReader};
use std::path::Path;

use serde_json::{json, Value};

use super::chain::line_hash;
use super::line::{
    now_ms, rfc3339_ms, AuditEvent, AuditLatch, Consent, DeliveryKind, Grant, GrantKind,
    GrantVerdict, Status, Tier, Warning,
};
use super::writer::{Anchor, WriterId};

/// One writer's segment state: the stamp and the chain.
#[derive(Debug, Clone)]
pub(super) struct Segment {
    hand_id: String,
    generation: u64,
    writer: WriterId,
    pub(super) seq: u64,
    pub(super) prev: String,
}

impl Segment {
    pub(super) fn new(hand_id: &str, generation: u64, writer: WriterId) -> Self {
        Self {
            hand_id: hand_id.to_owned(),
            generation,
            writer,
            seq: 0,
            prev: "meta".to_owned(),
        }
    }

    pub(super) fn meta(&self) -> Value {
        json!({
            "kind": "audit.meta",
            "schema": 2,
            "handId": self.hand_id,
            "generation": self.generation,
            "os": std::env::consts::OS,
            "writerPid": self.writer.pid,
            "writerProcStartMs": self.writer.proc_start_ms,
        })
    }
}

/// Stamps `event` as the segment's next line and advances the chain.
pub(super) fn stamp(segment: &mut Segment, event: &AuditEvent) -> io::Result<Value> {
    let mut line = json!({
        "v": 2,
        "ts": rfc3339_ms(now_ms()),
        "handId": segment.hand_id,
        "generation": segment.generation,
        "writerPid": segment.writer.pid,
        "writerProcStartMs": segment.writer.proc_start_ms,
        "seq": segment.seq + 1,
    });
    let Value::Object(body) = serde_json::to_value(event)? else {
        return Err(io::Error::other("an audit event is not an object"));
    };
    if let Some(object) = line.as_object_mut() {
        object.extend(body);
    }
    let hash = line_hash(&line);
    line["prev"] = json!(segment.prev);
    line["lineHash"] = json!(hash);
    segment.seq += 1;
    segment.prev = hash;
    Ok(line)
}

pub(super) fn anchor_event(anchor: &Anchor) -> AuditEvent {
    AuditEvent {
        action: "consent.anchor".to_owned(),
        target: "control".to_owned(),
        delivery: DeliveryKind::Control,
        tier: Tier::Read,
        grant: Some(Grant {
            kind: GrantKind::ConsentSave,
            verdict: GrantVerdict::RotationAnchor,
            consent: Some(Consent {
                fingerprint: anchor.fingerprint.clone(),
            }),
            latch: Some(AuditLatch {
                suspended: anchor.suspended,
                stop_epoch: anchor.stop_epoch,
            }),
        }),
        status: Status::Success,
        ..AuditEvent::default()
    }
}

/// The line of an event over the per-event cap: identity and outcome only.
pub(super) fn truncated(event: &AuditEvent) -> AuditEvent {
    AuditEvent {
        session_id: event.session_id.clone(),
        run_id: event.run_id.clone(),
        call_id: event.call_id.clone(),
        issuer: event.issuer.clone(),
        scope: event.scope.clone(),
        action: event.action.clone(),
        target: super::redact::truncate(&event.target),
        delivery: event.delivery,
        tier: event.tier,
        gate: event.gate.clone(),
        status: event.status,
        warnings: vec![Warning::TruncatedLine],
        ..AuditEvent::default()
    }
}

pub(super) fn last_line_hash(path: &Path) -> Option<String> {
    let file = File::open(path).ok()?;
    BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .filter_map(|text| serde_json::from_str::<Value>(&text).ok())
        .filter_map(|line| {
            line.get("lineHash")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .last()
}

#[cfg(unix)]
pub(super) fn lock(file: &File) -> io::Result<()> {
    use std::os::unix::io::AsRawFd;
    // SAFETY: the descriptor is open for the call; the lock drops with the file.
    if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) } == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(not(unix))]
pub(super) const fn lock(_file: &File) -> io::Result<()> {
    Ok(())
}
