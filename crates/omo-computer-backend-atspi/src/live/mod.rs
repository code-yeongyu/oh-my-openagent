//! `LiveBus`: the ONE accessibility-bus connection of the engine and its current-thread
//! runtime. The address comes from `AT_SPI_BUS_ADDRESS` or the session bus's `org.a11y.Bus`
//! (never from anything an application supplies). Every round trip is bounded by its slice
//! and the 5 s call budget, so one hung application costs one unknown node.

mod events;
mod files;
mod proxy;
mod reads;

use std::collections::VecDeque;
use std::future::Future;
use std::pin::pin;
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

use atspi::AccessibilityConnection;
use futures_lite::future::or;
use futures_lite::StreamExt;
use tokio::runtime::{Builder, Runtime};
use zbus::fdo::DBusProxy;
use zbus::{Message, MessageStream};

use crate::bus::{BusError, BusEvent, BusResult, CALL_BUDGET};

/// The most events kept between two reads; the oldest are dropped first.
const QUEUE_CAP: usize = 4_096;

/// Every message of the connection. It is read while any call is in flight: an undrained
/// stream stalls the replies behind an application's event burst.
pub(crate) struct Events {
    stream: MessageStream,
    queue: VecDeque<BusEvent>,
}

impl Events {
    fn keep(&mut self, message: &Message) {
        if let Some(event) = events::event_of(message) {
            if self.queue.len() == QUEUE_CAP {
                self.queue.pop_front();
            }
            self.queue.push_back(event);
        }
    }
}

enum Step<T> {
    Done(T),
    Message(Option<zbus::Result<Message>>),
}

pub struct LiveBus {
    rt: Runtime,
    a11y: AccessibilityConnection,
    /// The session bus: `org.a11y.Status` and the notification daemon's name owner.
    session: zbus::Connection,
    a11y_dbus: DBusProxy<'static>,
    events: Mutex<Events>,
    epoch: Instant,
}

async fn open() -> Result<
    (
        AccessibilityConnection,
        zbus::Connection,
        DBusProxy<'static>,
    ),
    BusError,
> {
    let a11y = match std::env::var("AT_SPI_BUS_ADDRESS") {
        Ok(address) if !address.trim().is_empty() => {
            let address = address.trim().parse().map_err(|_| BusError::Unreachable)?;
            AccessibilityConnection::from_address(address).await
        }
        _ => AccessibilityConnection::new().await,
    }
    .map_err(|_| BusError::Unreachable)?;
    let session = zbus::Connection::session()
        .await
        .map_err(|_| BusError::Unreachable)?;
    let a11y_dbus = DBusProxy::new(a11y.connection())
        .await
        .map_err(|_| BusError::Unreachable)?;
    Ok((a11y, session, a11y_dbus))
}

impl LiveBus {
    /// Connects to the accessibility bus and the session bus.
    ///
    /// # Errors
    /// `Unreachable` when either bus does not answer inside the call budget.
    pub fn connect() -> BusResult<Self> {
        let rt = Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|_| BusError::Unreachable)?;
        let opened = rt.block_on(async { tokio::time::timeout(CALL_BUDGET, open()).await });
        let (a11y, session, a11y_dbus) = opened.map_err(|_| BusError::Unreachable)??;
        let stream = MessageStream::from(a11y.connection());
        let events = Mutex::new(Events {
            stream,
            queue: VecDeque::new(),
        });
        Ok(Self {
            rt,
            a11y,
            session,
            a11y_dbus,
            events,
            epoch: Instant::now(),
        })
    }

    /// Runs one round trip inside `slice` (and never longer than the call budget), keeping
    /// the events that arrive meanwhile.
    pub(crate) fn call<T, E>(
        &self,
        slice: Duration,
        request: impl Future<Output = Result<T, E>>,
    ) -> BusResult<T>
    where
        E: std::fmt::Display,
    {
        let mut guard = self.events.lock().unwrap_or_else(PoisonError::into_inner);
        let events = &mut *guard;
        let answered = async {
            let mut request = pin!(request);
            loop {
                let done = async { Step::Done(request.as_mut().await) };
                let message = async { Step::Message(events.stream.next().await) };
                match or(done, message).await {
                    Step::Done(result) => return result,
                    Step::Message(Some(Ok(message))) => events.keep(&message),
                    Step::Message(Some(Err(_))) => {}
                    Step::Message(None) => return request.as_mut().await,
                }
            }
        };
        match self
            .rt
            .block_on(async { tokio::time::timeout(slice.min(CALL_BUDGET), answered).await })
        {
            Ok(Ok(value)) => Ok(value),
            Ok(Err(error)) => Err(BusError::Failed(error.to_string())),
            Err(_) => Err(BusError::Timeout),
        }
    }
}
