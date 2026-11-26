//! The events of the one connection: the registry registration, and the signals turned into
//! `BusEvent`s (`object:state-changed:focused` from the `org.a11y.atspi.Event.Object`
//! `StateChanged` signal with minor `focused`, ...).

use std::sync::PoisonError;
use std::time::Duration;

use atspi::events::object::{ChildrenChangedEvent, PropertyChangeEvent, StateChangedEvent};
use atspi::events::window::{ActivateEvent, CreateEvent, DeactivateEvent, DestroyEvent};
use futures_lite::future::poll_once;
use futures_lite::StreamExt;
use zbus::message::Type;
use zbus::Message;

use super::LiveBus;
use crate::bus::{BusError, BusEvent, BusResult, NodeId, CALL_BUDGET};

const EVENT_PREFIX: &str = "org.a11y.atspi.Event.";

/// `StateChanged` -> `state-changed`.
fn kebab(member: &str) -> String {
    let mut out = String::new();
    for (index, c) in member.chars().enumerate() {
        if c.is_ascii_uppercase() && index > 0 {
            out.push('-');
        }
        out.push(c.to_ascii_lowercase());
    }
    out
}

/// The event a signal carries, or `None` for any other message.
pub(crate) fn event_of(message: &Message) -> Option<BusEvent> {
    let header = message.header();
    if header.message_type() != Type::Signal {
        return None;
    }
    let family = header
        .interface()?
        .as_str()
        .strip_prefix(EVENT_PREFIX)?
        .to_ascii_lowercase();
    let member = kebab(header.member()?.as_str());
    let body = message.body();
    let (minor, detail) = body
        .deserialize::<atspi::events::EventBodyOwned>()
        .map(|body| (body.kind, body.detail1))
        .or_else(|_| {
            body.deserialize::<atspi::events::EventBodyQtOwned>()
                .map(|body| (body.kind, body.detail1))
        })
        .ok()?;
    let kind = if minor.is_empty() {
        format!("{family}:{member}")
    } else {
        format!("{family}:{member}:{minor}")
    };
    let sender = NodeId::new(header.sender()?.as_str(), header.path()?.as_str());
    Some(BusEvent {
        kind,
        sender,
        detail,
    })
}

impl LiveBus {
    /// `RegisterEvent` plus the match rule for every event the backend listens to.
    pub(crate) fn register(&self) -> BusResult<()> {
        let a11y = &self.a11y;
        self.call(CALL_BUDGET, async {
            a11y.register_event::<ActivateEvent>().await?;
            a11y.register_event::<DeactivateEvent>().await?;
            a11y.register_event::<CreateEvent>().await?;
            a11y.register_event::<DestroyEvent>().await?;
            a11y.register_event::<StateChangedEvent>().await?;
            a11y.register_event::<ChildrenChangedEvent>().await?;
            a11y.register_event::<PropertyChangeEvent>().await?;
            Ok::<(), atspi::AtspiError>(())
        })
    }

    /// Every event the connection already read, in arrival order: no round trip.
    pub(crate) fn drain(&mut self) -> Vec<BusEvent> {
        let Self { rt, events, .. } = self;
        let events = events.get_mut().unwrap_or_else(PoisonError::into_inner);
        rt.block_on(async {
            for _ in 0..4 {
                tokio::task::yield_now().await;
            }
            while let Some(Some(Ok(message))) = poll_once(events.stream.next()).await {
                events.keep(&message);
            }
        });
        events.queue.drain(..).collect()
    }

    /// The next event inside `timeout`, waiting on the stream (no sleep, no poll loop).
    pub(crate) fn next_event(&mut self, timeout: Duration) -> BusResult<Option<BusEvent>> {
        let mut pending = self.drain().into_iter();
        let Self { rt, events, .. } = self;
        let events = events.get_mut().unwrap_or_else(PoisonError::into_inner);
        if let Some(event) = pending.next() {
            events.queue.extend(pending);
            return Ok(Some(event));
        }
        let stream = &mut events.stream;
        let waited = rt.block_on(async {
            tokio::time::timeout(timeout.min(CALL_BUDGET), async {
                while let Some(message) = stream.next().await {
                    if let Some(event) = message.ok().as_ref().and_then(event_of) {
                        return Some(event);
                    }
                }
                None
            })
            .await
        });
        match waited {
            Ok(Some(event)) => Ok(Some(event)),
            Ok(None) => Err(BusError::Unreachable),
            Err(_) => Ok(None),
        }
    }
}
