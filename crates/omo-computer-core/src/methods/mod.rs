//! The method table, its lookups and the notification set.

mod spec;
mod table;

use schemars::{Schema, SchemaGenerator};

pub use spec::{Effect, Exposure, MethodSpec, PeerKind};
pub(crate) use table::method_schemas;
pub use table::{Method, METHODS};

use crate::observation::Frame;
use crate::results::{AuditLine, ControlState, EpochChanged, HandStatus, StopPathStatus};

/// The prefix a one-shot call puts before a method name (`desktop.click` calls `click`).
pub const ONESHOT_PREFIX: &str = "desktop.";

/// One-shot spellings that do not strip to a method name.
pub const ONESHOT_ALIASES: &[(&str, &str)] = &[("desktop.stop", "stopPath.stop")];

impl Method {
    #[must_use]
    pub fn spec(self) -> &'static MethodSpec {
        &METHODS[self as usize]
    }

    /// The method named `name` exactly, or `None` (`-32601`).
    #[must_use]
    pub fn from_name(name: &str) -> Option<Self> {
        METHODS
            .iter()
            .find(|spec| spec.name == name)
            .map(|spec| spec.method)
    }

    /// The method a one-shot call names: the exact name, an alias, or the name after `desktop.`.
    #[must_use]
    pub fn from_oneshot(name: &str) -> Option<Self> {
        Self::from_name(name)
            .or_else(|| {
                ONESHOT_ALIASES
                    .iter()
                    .find(|(alias, _)| *alias == name)
                    .and_then(|(_, target)| Self::from_name(target))
            })
            .or_else(|| name.strip_prefix(ONESHOT_PREFIX).and_then(Self::from_name))
    }
}

/// The engine-to-host notifications and the schema of their params.
pub(crate) fn notification_schemas(generator: &mut SchemaGenerator) -> Vec<(&'static str, Schema)> {
    vec![
        ("audit", generator.subschema_for::<AuditLine>()),
        (
            "stopPath.changed",
            generator.subschema_for::<StopPathStatus>(),
        ),
        ("epoch.changed", generator.subschema_for::<EpochChanged>()),
        ("control.changed", generator.subschema_for::<ControlState>()),
        ("preview.frame", generator.subschema_for::<Frame>()),
        ("hand.status", generator.subschema_for::<HandStatus>()),
    ]
}
