//! `LiveBus`: the accessibility-bus connection and its current-thread runtime.
//! Every round trip is bounded, so one hung application cannot wedge the
//! session thread.

use std::fmt::Display;
use std::future::Future;
use std::time::Duration;

use atspi::{AccessibilityConnection, AtspiError, ObjectRefOwned};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use tokio::runtime::{Builder, Runtime};
use zbus::fdo::DBusProxy;
use zbus::names::BusName;
use zbus::proxy::{CacheProperties, Defaults};

use crate::bus::BusResult;

/// Longest wait for one AT-SPI reply before the call reports a failure.
const CALL_BUDGET: Duration = Duration::from_secs(5);

pub struct LiveBus {
    rt: Runtime,
    connection: AccessibilityConnection,
    dbus: DBusProxy<'static>,
}

impl LiveBus {
    /// Connects to the accessibility bus: `AT_SPI_BUS_ADDRESS` when set (the
    /// libatspi override), else the address `org.a11y.Bus` publishes on the
    /// session bus.
    pub(crate) fn connect() -> CoreResult<Self> {
        let rt = Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|err| DesktopError::ax_failed(format!("AT-SPI runtime: {err}")))?;
        let (connection, dbus) = rt
            .block_on(async { tokio::time::timeout(CALL_BUDGET, open()).await })
            .map_err(|_| DesktopError::ax_failed("AT-SPI connection: the bus did not answer"))?
            .map_err(|err| DesktopError::ax_failed(format!("AT-SPI connection: {err}")))?;
        Ok(Self { rt, connection, dbus })
    }

    /// Runs one round trip to completion within [`CALL_BUDGET`].
    pub(crate) fn call<T, E: Display>(
        &self,
        what: &str,
        request: impl Future<Output = Result<T, E>>,
    ) -> BusResult<T> {
        // The timer must be created inside the runtime it runs on.
        match self
            .rt
            .block_on(async { tokio::time::timeout(CALL_BUDGET, request).await })
        {
            Ok(Ok(value)) => Ok(value),
            Ok(Err(err)) => Err(format!("AT-SPI {what}: {err}")),
            Err(_) => Err(format!(
                "AT-SPI {what}: no reply within {} ms",
                CALL_BUDGET.as_millis()
            )),
        }
    }

    /// One round trip through an uncached proxy of interface `P` on `node`.
    pub(crate) fn with_proxy<P, T, F>(
        &self,
        what: &str,
        node: &ObjectRefOwned,
        request: impl FnOnce(P) -> F,
    ) -> BusResult<T>
    where
        P: Defaults + From<zbus::Proxy<'static>>,
        F: Future<Output = zbus::Result<T>>,
    {
        self.call(what, async {
            request(proxy::<P>(self.connection.connection(), node).await?).await
        })
    }

    pub(crate) fn applications(&self) -> BusResult<Vec<ObjectRefOwned>> {
        self.call("applications", async {
            let root = self.connection.root_accessible_on_registry().await?;
            root.get_children().await.map_err(AtspiError::from)
        })
    }

    pub(crate) fn process_id(&self, app: &ObjectRefOwned) -> Option<u32> {
        let name = BusName::from(app.name()?.clone());
        self.call("pid", self.dbus.get_connection_unix_process_id(name))
            .ok()
    }
}

async fn open() -> Result<(AccessibilityConnection, DBusProxy<'static>), AtspiError> {
    let connection = match std::env::var("AT_SPI_BUS_ADDRESS") {
        Ok(address) if !address.trim().is_empty() => {
            AccessibilityConnection::from_address(address.trim().parse()?).await?
        }
        _ => AccessibilityConnection::new().await?,
    };
    let dbus = DBusProxy::new(connection.connection()).await?;
    Ok((connection, dbus))
}

/// An uncached proxy of interface `P` on `node` (short-lived proxies must not
/// pay a `GetAll` plus a match rule each).
async fn proxy<P>(connection: &zbus::Connection, node: &ObjectRefOwned) -> zbus::Result<P>
where
    P: Defaults + From<zbus::Proxy<'static>>,
{
    let name = node
        .name()
        .ok_or_else(|| zbus::Error::Failure("AT-SPI object has no bus name".to_string()))?
        .clone();
    zbus::proxy::Builder::<P>::new(connection)
        .destination(name)?
        .path(node.path().clone())?
        .cache_properties(CacheProperties::No)
        .build()
        .await
}
