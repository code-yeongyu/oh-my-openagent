//! The per-toolkit route table as DATA (acceptance 75; design rows C16, C19): exact keys -
//! bundle id, `WM_CLASS`, window class - each naming one toolkit class, seeded from
//! `data/toolkit-routes.json` and extended by the user through `computer.toolkit_routes`. The
//! table loads only exact keys: a key that is empty, padded or carries a pattern character fails
//! the load with the JSON pointer of the offending entry, and so does an unknown class. Nothing
//! here probes a process or learns a refusal: a learned key only changes the default delivery.

mod membership;
#[cfg(test)]
mod citation_tests;
#[cfg(test)]
mod tests;

use std::collections::BTreeMap;

pub use membership::{is_chromium_electron, Membership};
use serde::Deserialize;
use serde_json::Value;

use crate::settings::ToolkitClass;

/// The seed the engine ships.
pub const SEED: &str = include_str!("../../data/toolkit-routes.json");

/// The OS family a key belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RouteOs {
    Macos,
    X11,
    Windows,
}

/// A table that failed its load test, and where.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RouteTableInvalid {
    /// The JSON pointer of the offending entry (RFC 6901).
    pub pointer: String,
}

/// The loaded table: one class per exact key, per OS.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RouteTable {
    routes: BTreeMap<(RouteOs, String), ToolkitClass>,
    membership: Membership,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SeedRow {
    os: RouteOs,
    #[serde(rename = "keyKind")]
    _key_kind: String,
    key: String,
    class: Value,
    #[serde(rename = "cite")]
    _cite: String,
}

impl RouteTable {
    /// The shipped seed.
    ///
    /// # Errors
    /// [`RouteTableInvalid`] when the shipped data fails its own load test.
    pub fn seed() -> Result<Self, RouteTableInvalid> {
        Self::load(&serde_json::from_str(SEED).map_err(|_| invalid(""))?)
    }

    /// Loads a table document `{routes: [...], membership: {...}}`.
    ///
    /// # Errors
    /// [`RouteTableInvalid`] naming the first entry that is not an exact key of a known class.
    pub fn load(doc: &Value) -> Result<Self, RouteTableInvalid> {
        let rows = doc.get("routes").and_then(Value::as_array).ok_or_else(|| invalid("/routes"))?;
        let mut routes = BTreeMap::new();
        for (index, row) in rows.iter().enumerate() {
            let at = format!("/routes/{index}");
            let row: SeedRow = serde_json::from_value(row.clone()).map_err(|_| invalid(&at))?;
            let class = parse_class(&row.class).ok_or_else(|| invalid(&format!("{at}/class")))?;
            if !is_exact_key(&row.key) {
                return Err(invalid(&format!("{at}/key")));
            }
            routes.insert((row.os, row.key), class);
        }
        let membership = Membership::load(doc.get("membership"))?;
        Ok(Self { routes, membership })
    }

    /// Adds the user's `computer.toolkit_routes` entries for `os`, each an exact key.
    ///
    /// # Errors
    /// [`RouteTableInvalid`] at `/toolkit_routes/<key>` for a key that is not exact.
    pub fn extend(&mut self, os: RouteOs, user: &BTreeMap<String, ToolkitClass>) -> Result<(), RouteTableInvalid> {
        for (key, class) in user {
            if !is_exact_key(key) {
                return Err(invalid(&format!("/toolkit_routes/{}", escape(key))));
            }
            self.routes.insert((os, key.clone()), *class);
        }
        Ok(())
    }

    /// The class of an exact key on `os`; never a substring, never a case fold.
    #[must_use]
    pub fn class_of(&self, os: RouteOs, key: &str) -> Option<ToolkitClass> {
        self.routes.get(&(os, key.to_owned())).copied()
    }

    #[must_use]
    pub const fn membership(&self) -> &Membership {
        &self.membership
    }

    /// Every seeded `(os, key, class)`, in key order.
    pub fn entries(&self) -> impl Iterator<Item = (RouteOs, &str, ToolkitClass)> {
        self.routes.iter().map(|((os, key), class)| (*os, key.as_str(), *class))
    }
}

/// An exact key: non-empty, unpadded, and free of the characters a pattern would need.
#[must_use]
pub fn is_exact_key(key: &str) -> bool {
    !key.is_empty() && key.trim() == key && !key.contains(['*', '?', '[', ']'])
}

fn parse_class(value: &Value) -> Option<ToolkitClass> {
    serde_json::from_value(value.clone()).ok()
}

pub(crate) fn invalid(pointer: &str) -> RouteTableInvalid {
    RouteTableInvalid {
        pointer: pointer.to_owned(),
    }
}

fn escape(key: &str) -> String {
    key.replace('~', "~0").replace('/', "~1")
}
