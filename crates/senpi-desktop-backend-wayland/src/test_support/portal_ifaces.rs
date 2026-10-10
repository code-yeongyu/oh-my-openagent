//! The fake portal's D-Bus interfaces. Every request answers through the
//! `org.freedesktop.portal.Request` `Response` signal on the handle path the
//! caller derived from its unique name and `handle_token`, like
//! xdg-desktop-portal.

use std::collections::HashMap;
use std::sync::Arc;

use zbus::message::Header;
use zbus::zvariant::{ObjectPath, OwnedFd, OwnedObjectPath, OwnedValue, Value};
use zbus::{fdo, interface, Connection};

use super::fake_portal::{Reply, State};

pub type Options = HashMap<String, OwnedValue>;
type Results<'a> = HashMap<&'static str, Value<'a>>;

pub fn absent(interface: &str) -> fdo::Error {
    fdo::Error::InvalidArgs(format!("No such interface \u{201c}{interface}\u{201d}"))
}

fn sender_segment(header: &Header<'_>) -> fdo::Result<String> {
    let sender = header
        .sender()
        .ok_or_else(|| fdo::Error::Failed("request without a sender".to_owned()))?;
    Ok(sender.trim_start_matches(':').replace('.', "_"))
}

fn token<'a>(options: &'a Options, key: &str) -> fdo::Result<&'a str> {
    options
        .get(key)
        .and_then(|value| value.downcast_ref::<&str>().ok())
        .ok_or_else(|| fdo::Error::InvalidArgs(format!("missing {key}")))
}

/// Emits `Response(code, results)` on the request handle and returns it.
pub async fn respond(
    connection: &Connection,
    header: &Header<'_>,
    options: &Options,
    (code, results): (u32, Results<'_>),
) -> fdo::Result<OwnedObjectPath> {
    let path = format!(
        "/org/freedesktop/portal/desktop/request/{}/{}",
        sender_segment(header)?,
        token(options, "handle_token")?
    );
    connection
        .emit_signal(
            header.sender().cloned(),
            path.as_str(),
            "org.freedesktop.portal.Request",
            "Response",
            &(code, results),
        )
        .await?;
    OwnedObjectPath::try_from(path).map_err(|error| fdo::Error::Failed(error.to_string()))
}

/// Registers a session object for `options["session_handle_token"]`.
async fn create_session(
    connection: &Connection,
    header: &Header<'_>,
    options: &Options,
) -> fdo::Result<String> {
    let path = format!(
        "/org/freedesktop/portal/desktop/session/{}/{}",
        sender_segment(header)?,
        token(options, "session_handle_token")?
    );
    connection.object_server().at(path.as_str(), FakeSession).await?;
    Ok(path)
}

struct FakeSession;

#[interface(name = "org.freedesktop.portal.Session")]
impl FakeSession {
    fn close(&self) {}

    #[zbus(property, name = "version")]
    fn version(&self) -> u32 {
        1
    }
}

pub struct RemoteDesktopPortal(Arc<State>);

impl RemoteDesktopPortal {
    pub const fn new(state: Arc<State>) -> Self {
        Self(state)
    }

    fn reply(&self) -> Reply {
        self.0.mode().remote_desktop
    }

    fn present(&self) -> fdo::Result<()> {
        match self.reply() {
            Reply::Absent => Err(absent("org.freedesktop.portal.RemoteDesktop")),
            Reply::Grant | Reply::Deny => Ok(()),
        }
    }
}

#[interface(name = "org.freedesktop.portal.RemoteDesktop")]
impl RemoteDesktopPortal {
    #[zbus(property, name = "version")]
    fn version(&self) -> fdo::Result<u32> {
        self.present().map(|()| 2)
    }

    #[zbus(property, name = "AvailableDeviceTypes")]
    fn available_device_types(&self) -> u32 {
        3
    }

    async fn create_session(
        &self,
        options: Options,
        #[zbus(header)] header: Header<'_>,
        #[zbus(connection)] connection: &Connection,
    ) -> fdo::Result<OwnedObjectPath> {
        self.present()?;
        let session = create_session(connection, &header, &options).await?;
        let results = HashMap::from([("session_handle", Value::from(session))]);
        respond(connection, &header, &options, (0, results)).await
    }

    async fn select_devices(
        &self,
        _session_handle: ObjectPath<'_>,
        options: Options,
        #[zbus(header)] header: Header<'_>,
        #[zbus(connection)] connection: &Connection,
    ) -> fdo::Result<OwnedObjectPath> {
        self.present()?;
        respond(connection, &header, &options, (0, HashMap::new())).await
    }

    async fn start(
        &self,
        _session_handle: ObjectPath<'_>,
        _parent_window: String,
        options: Options,
        #[zbus(header)] header: Header<'_>,
        #[zbus(connection)] connection: &Connection,
    ) -> fdo::Result<OwnedObjectPath> {
        self.present()?;
        let answer = match self.reply() {
            Reply::Grant => (0, HashMap::from([("devices", Value::from(3_u32))])),
            Reply::Deny | Reply::Absent => (1, HashMap::new()),
        };
        respond(connection, &header, &options, answer).await
    }

    #[zbus(name = "ConnectToEIS")]
    fn connect_to_eis(&self, _session_handle: ObjectPath<'_>, _options: Options) -> fdo::Result<OwnedFd> {
        self.present()?;
        let stream = self
            .0
            .connect_eis()
            .map_err(|error| fdo::Error::IOError(error.to_string()))?;
        Ok(OwnedFd::from(std::os::fd::OwnedFd::from(stream)))
    }
}

pub struct GlobalShortcutsPortal(Arc<State>);

impl GlobalShortcutsPortal {
    pub const fn new(state: Arc<State>) -> Self {
        Self(state)
    }

    fn reply(&self) -> Reply {
        self.0.mode().global_shortcuts
    }

    fn present(&self) -> fdo::Result<()> {
        match self.reply() {
            Reply::Absent => Err(absent("org.freedesktop.portal.GlobalShortcuts")),
            Reply::Grant | Reply::Deny => Ok(()),
        }
    }
}

type NewShortcut = (String, HashMap<String, OwnedValue>);

#[interface(name = "org.freedesktop.portal.GlobalShortcuts")]
impl GlobalShortcutsPortal {
    #[zbus(property, name = "version")]
    fn version(&self) -> fdo::Result<u32> {
        self.present().map(|()| 1)
    }

    async fn create_session(
        &self,
        options: Options,
        #[zbus(header)] header: Header<'_>,
        #[zbus(connection)] connection: &Connection,
    ) -> fdo::Result<OwnedObjectPath> {
        self.present()?;
        let session = create_session(connection, &header, &options).await?;
        self.0.recorded().shortcuts_session = Some(session.clone());
        let results = HashMap::from([("session_handle", Value::from(session))]);
        respond(connection, &header, &options, (0, results)).await
    }

    async fn bind_shortcuts(
        &self,
        _session_handle: ObjectPath<'_>,
        shortcuts: Vec<NewShortcut>,
        _parent_window: String,
        options: Options,
        #[zbus(header)] header: Header<'_>,
        #[zbus(connection)] connection: &Connection,
    ) -> fdo::Result<OwnedObjectPath> {
        self.present()?;
        let mut bound = Vec::new();
        for (id, info) in &shortcuts {
            let trigger = info
                .get("preferred_trigger")
                .and_then(|value| value.downcast_ref::<&str>().ok())
                .map(str::to_owned);
            self.0.recorded().bound.push((id.clone(), trigger.clone()));
            let info = HashMap::from([
                ("description", Value::from("stop")),
                ("trigger_description", Value::from(trigger.unwrap_or_default())),
            ]);
            bound.push((id.clone(), info));
        }
        let answer = match self.reply() {
            Reply::Grant => (0, HashMap::from([("shortcuts", Value::from(bound))])),
            Reply::Deny | Reply::Absent => (1, HashMap::new()),
        };
        respond(connection, &header, &options, answer).await
    }
}
