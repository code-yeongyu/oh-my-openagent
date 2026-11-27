//! Per-live-connection, finite approval and replay boundary.
use crate::{roles::Role, RejectReason, VerifiedPeer};
use sha2::{Digest, Sha256};
use std::{
    collections::VecDeque,
    time::{Duration, Instant},
};

pub(crate) const MAX_REQUEST_BYTES: usize = 1024 * 1024;
const MAX_BATCH: usize = 64;
const MAX_APPROVAL_LIFETIME: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum TransportError {
    #[error("peer requirement failed: {0}")]
    Requirement(i32),
    #[error("identity refused: {0:?}")]
    Identity(RejectReason),
    #[error("invalid XPC dictionary")]
    Dictionary,
    #[error("connection closed")]
    Closed,
    #[error("challenge required")]
    Challenge,
    #[error("approval missing, expired, or mismatched")]
    Approval,
    #[error("capability mismatch")]
    Capability,
    #[error("sequence mismatch")]
    Sequence,
    #[error("XPC allocation failed")]
    Allocation,
    #[error("XPC peer user mismatch")]
    User,
    #[error("random capability generation failed")]
    Random,
    #[error("connection capacity exhausted")]
    Capacity,
    #[error("XPC transport requires macOS 13 or newer")]
    UnsupportedOs,
}

pub(crate) enum Envelope {
    Challenge([u8; 32]),
    Approve {
        hashes: Vec<[u8; 32]>,
        lifetime: Duration,
    },
    Frame {
        capability: [u8; 32],
        sequence: u64,
        payload: Vec<u8>,
    },
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Accepted {
    Challenge([u8; 32]),
    Approved([u8; 32]),
    Frame(Vec<u8>),
}

pub(crate) struct SessionGate {
    capability: [u8; 32],
    sequence: u64,
    challenged: bool,
    closed: bool,
    hashes: VecDeque<[u8; 32]>,
    deadline: Option<Instant>,
}

impl SessionGate {
    pub(crate) fn new(capability: [u8; 32]) -> Self {
        Self {
            capability,
            sequence: 1,
            challenged: false,
            closed: false,
            hashes: VecDeque::new(),
            deadline: None,
        }
    }

    pub(crate) fn digest(payload: &[u8]) -> [u8; 32] {
        Sha256::digest(payload).into()
    }

    pub(crate) fn is_closed(&self) -> bool {
        self.closed
    }

    pub(crate) fn reply_capability(&self) -> Result<[u8; 32], TransportError> {
        if self.closed {
            Err(TransportError::Closed)
        } else {
            Ok(self.capability)
        }
    }

    pub(crate) fn close(&mut self) {
        self.closed = true;
        self.capability.fill(0);
        self.hashes.clear();
        self.deadline = None;
    }

    /// The decoder is called only after the live dictionary's O1 result passes.
    pub(crate) fn receive(
        &mut self,
        peer: Result<VerifiedPeer, RejectReason>,
        decode: impl FnOnce() -> Result<Envelope, TransportError>,
        now: Instant,
    ) -> Result<Accepted, TransportError> {
        let result = self.receive_open(peer, decode, now);
        if result.is_err() {
            self.close();
        }
        result
    }

    fn receive_open(
        &mut self,
        peer: Result<VerifiedPeer, RejectReason>,
        decode: impl FnOnce() -> Result<Envelope, TransportError>,
        now: Instant,
    ) -> Result<Accepted, TransportError> {
        if self.closed {
            return Err(TransportError::Closed);
        }
        let peer = peer.map_err(TransportError::Identity)?;
        if peer.role() != Role::NativeController {
            return Err(TransportError::Identity(RejectReason::RoleMismatch));
        }
        match decode()? {
            Envelope::Challenge(nonce) => {
                if self.challenged {
                    return Err(TransportError::Challenge);
                }
                self.challenged = true;
                Ok(Accepted::Challenge(nonce))
            }
            Envelope::Approve { hashes, lifetime } => {
                if !self.challenged {
                    return Err(TransportError::Challenge);
                }
                if !self.hashes.is_empty()
                    || hashes.is_empty()
                    || hashes.len() > MAX_BATCH
                    || lifetime.is_zero()
                    || lifetime > MAX_APPROVAL_LIFETIME
                {
                    return Err(TransportError::Approval);
                }
                self.deadline = now.checked_add(lifetime);
                if self.deadline.is_none() {
                    return Err(TransportError::Approval);
                }
                self.hashes = hashes.into();
                Ok(Accepted::Approved(self.capability))
            }
            Envelope::Frame {
                capability,
                sequence,
                payload,
            } => {
                if !self.challenged {
                    return Err(TransportError::Challenge);
                }
                if !crate::capability::matches(&capability, &self.capability) {
                    return Err(TransportError::Capability);
                }
                if sequence != self.sequence {
                    return Err(TransportError::Sequence);
                }
                if payload.is_empty() || payload.len() > MAX_REQUEST_BYTES {
                    return Err(TransportError::Dictionary);
                }
                if !self.deadline.is_some_and(|deadline| now < deadline)
                    || self.hashes.front() != Some(&Self::digest(&payload))
                {
                    return Err(TransportError::Approval);
                }
                self.sequence = self
                    .sequence
                    .checked_add(1)
                    .ok_or(TransportError::Sequence)?;
                self.hashes.pop_front();
                Ok(Accepted::Frame(payload))
            }
        }
    }
}

impl Drop for SessionGate {
    fn drop(&mut self) {
        self.close();
    }
}
