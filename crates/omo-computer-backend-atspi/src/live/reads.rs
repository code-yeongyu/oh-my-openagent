//! `Bus` over D-Bus: each method is bounded round trips through the AT-SPI proxy that owns it,
//! built uncached (Qt refuses `GetAll`); action names are read per index (a batched
//! `GetActions` aborts at-spi2-atk 2.38 applications). The role is the `GetRole` enum's
//! name: GTK 4.14 answers `GetRoleName` with `application` for every object.

use std::path::PathBuf;
use std::time::Duration;

use atspi::proxy::accessible::{AccessibleProxy, ObjectRefExt};
use atspi::proxy::action::ActionProxy;
use atspi::proxy::bus::StatusProxy;
use atspi::proxy::component::ComponentProxy;
use atspi::proxy::document::DocumentProxy;
use atspi::proxy::selection::SelectionProxy;
use atspi::proxy::text::TextProxy;
use atspi::{CoordType, Interface, State};
use zbus::names::BusName;

use super::proxy::{id_of, libatspi_name, proxy};
use super::LiveBus;
use crate::bus::{
    AppRef, Bus, BusEvent, BusResult, Extents, Interfaces, NodeFacts, NodeId, OwnerProcess, States,
    CALL_BUDGET,
};

const TEXT_CHARS: i32 = 4_096;

impl Bus for LiveBus {
    fn now_ms(&self) -> u64 {
        u64::try_from(self.epoch.elapsed().as_millis()).unwrap_or(u64::MAX)
    }

    fn applications(&mut self, slice: Duration) -> BusResult<Vec<AppRef>> {
        let (a11y, dbus) = (&self.a11y, &self.a11y_dbus);
        self.call(slice, async {
            let root = a11y.root_accessible_on_registry().await?;
            let mut apps = Vec::new();
            for child in root.get_children().await? {
                let Some(node) = id_of(&child) else { continue };
                let pid = match BusName::try_from(node.bus.as_str()) {
                    Ok(name) => dbus.get_connection_unix_process_id(name).await.ok(),
                    Err(_) => None,
                };
                let name = child
                    .as_accessible_proxy(a11y.connection())
                    .await?
                    .name()
                    .await
                    .unwrap_or_default();
                apps.push(AppRef { node, pid, name });
            }
            Ok::<_, atspi::AtspiError>(apps)
        })
    }

    fn children(&mut self, node: &NodeId, slice: Duration) -> BusResult<Vec<NodeId>> {
        let connection = self.a11y.connection();
        self.call(slice, async {
            let found = proxy::<AccessibleProxy<'static>>(connection, node)
                .await?
                .get_children()
                .await?;
            Ok::<_, zbus::Error>(found.iter().filter_map(id_of).collect())
        })
    }

    fn read(&mut self, node: &NodeId, slice: Duration) -> BusResult<NodeFacts> {
        let connection = self.a11y.connection();
        self.call(slice, async {
            let accessible = proxy::<AccessibleProxy<'static>>(connection, node).await?;
            let interfaces = accessible.get_interfaces().await?;
            let state = accessible.get_state().await?;
            let extents =
                if interfaces.contains(Interface::Component) {
                    let component = proxy::<ComponentProxy<'static>>(connection, node).await?;
                    component.get_extents(CoordType::Screen).await.ok().map(
                        |(x, y, width, height)| Extents {
                            x,
                            y,
                            width,
                            height,
                        },
                    )
                } else {
                    None
                };
            Ok::<_, zbus::Error>(NodeFacts {
                role: libatspi_name(accessible.get_role().await?.name()).to_owned(),
                name: accessible.name().await.ok(),
                description: accessible.description().await.ok(),
                accessible_id: accessible.accessible_id().await.ok(),
                states: States {
                    focused: state.contains(State::Focused),
                    busy: state.contains(State::Busy),
                    checked: state.contains(State::Checked),
                    enabled: state.contains(State::Enabled) || state.contains(State::Sensitive),
                    active: state.contains(State::Active),
                    expanded: state.contains(State::Expanded),
                    selected: state.contains(State::Selected),
                },
                interfaces: Interfaces {
                    action: interfaces.contains(Interface::Action),
                    text: interfaces.contains(Interface::Text),
                    component: interfaces.contains(Interface::Component),
                },
                child_count: u32::try_from(accessible.child_count().await?).unwrap_or(0),
                extents,
            })
        })
    }

    fn text(&mut self, node: &NodeId, slice: Duration) -> BusResult<String> {
        let connection = self.a11y.connection();
        self.call(slice, async {
            let text = proxy::<TextProxy<'static>>(connection, node).await?;
            let count = text.character_count().await?.min(TEXT_CHARS);
            text.get_text(0, count).await
        })
    }

    fn parent(&mut self, node: &NodeId, slice: Duration) -> BusResult<Option<NodeId>> {
        let connection = self.a11y.connection();
        self.call(slice, async {
            Ok::<_, zbus::Error>(id_of(
                &proxy::<AccessibleProxy<'static>>(connection, node)
                    .await?
                    .parent()
                    .await?,
            ))
        })
    }

    fn action_count(&mut self, node: &NodeId, slice: Duration) -> BusResult<i32> {
        let connection = self.a11y.connection();
        self.call(slice, async {
            proxy::<ActionProxy<'static>>(connection, node)
                .await?
                .n_actions()
                .await
        })
    }

    fn action_name(&mut self, node: &NodeId, index: i32, slice: Duration) -> BusResult<String> {
        let connection = self.a11y.connection();
        self.call(slice, async {
            proxy::<ActionProxy<'static>>(connection, node)
                .await?
                .get_name(index)
                .await
        })
    }

    fn do_action(&mut self, node: &NodeId, index: i32, slice: Duration) -> BusResult<bool> {
        let connection = self.a11y.connection();
        self.call(slice, async {
            proxy::<ActionProxy<'static>>(connection, node)
                .await?
                .do_action(index)
                .await
        })
    }

    fn clear_selection(&mut self, node: &NodeId, slice: Duration) -> BusResult<bool> {
        let connection = self.a11y.connection();
        self.call(slice, async {
            proxy::<SelectionProxy<'static>>(connection, node)
                .await?
                .clear_selection()
                .await
        })
    }

    fn attributes(&mut self, node: &NodeId, slice: Duration) -> BusResult<Vec<(String, String)>> {
        let connection = self.a11y.connection();
        self.call(slice, async {
            let found = match proxy::<DocumentProxy<'static>>(connection, node)
                .await?
                .get_attributes()
                .await
            {
                Ok(found) => found,
                Err(_) => {
                    proxy::<AccessibleProxy<'static>>(connection, node)
                        .await?
                        .get_attributes()
                        .await?
                }
            };
            Ok::<_, zbus::Error>(found.into_iter().collect())
        })
    }

    fn a11y_enabled(&mut self) -> BusResult<bool> {
        let session = &self.session;
        self.call(CALL_BUDGET, async {
            StatusProxy::new(session).await?.is_enabled().await
        })
    }

    fn set_a11y_enabled(&mut self, enabled: bool) -> BusResult<()> {
        let session = &self.session;
        self.call(CALL_BUDGET, async {
            StatusProxy::new(session)
                .await?
                .set_is_enabled(enabled)
                .await
        })
    }

    fn register_events(&mut self, _kinds: &[&str]) -> BusResult<()> {
        self.register()
    }

    fn pending_events(&mut self) -> Vec<BusEvent> {
        self.drain()
    }

    fn wait_event(&mut self, timeout: Duration) -> BusResult<Option<BusEvent>> {
        self.next_event(timeout)
    }

    fn notification_owner(&mut self) -> BusResult<Option<OwnerProcess>> {
        let session = &self.session;
        self.call(CALL_BUDGET, async {
            let dbus = zbus::fdo::DBusProxy::new(session).await?;
            let Ok(owner) = dbus
                .get_name_owner(
                    BusName::try_from("org.freedesktop.Notifications")
                        .map_err(zbus::Error::from)?,
                )
                .await
            else {
                return Ok::<_, zbus::fdo::Error>(None);
            };
            let pid = dbus
                .get_connection_unix_process_id(BusName::from(owner))
                .await?;
            let name = std::fs::read_to_string(format!("/proc/{pid}/comm"))
                .unwrap_or_default()
                .trim()
                .to_owned();
            Ok(Some(OwnerProcess { pid, name }))
        })
    }

    fn desktop_files(&mut self) -> Vec<(PathBuf, String)> {
        super::files::desktop_files()
    }
}
