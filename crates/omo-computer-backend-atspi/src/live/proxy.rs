//! The uncached proxy every round trip is built from, and the conversions between the AT-SPI
//! crate's object references and role names and the backend's.

use atspi::ObjectRefOwned;
use zbus::proxy::{CacheProperties, Defaults};

use crate::bus::NodeId;

pub(super) async fn proxy<P>(connection: &zbus::Connection, node: &NodeId) -> zbus::Result<P>
where
    P: Defaults + From<zbus::Proxy<'static>>,
{
    zbus::proxy::Builder::<P>::new(connection)
        .destination(node.bus.clone())?
        .path(node.path.clone())?
        .cache_properties(CacheProperties::No)
        .build()
        .await
}

/// libatspi's role name (`push button`) where the crate's differs (`button`): the backend
/// decides on one vocabulary.
pub(super) fn libatspi_name(role: &str) -> &str {
    if role == "button" {
        "push button"
    } else {
        role
    }
}

pub(super) fn id_of(object: &ObjectRefOwned) -> Option<NodeId> {
    if object.is_null() {
        return None;
    }
    Some(NodeId::new(object.name_as_str()?, object.path_as_str()))
}
