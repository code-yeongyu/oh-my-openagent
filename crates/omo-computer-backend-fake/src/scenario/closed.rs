//! Reading the closed engine codes and reason tokens of the error table from a scenario. An
//! unknown spelling is serde's "unknown variant" error, so the loader points at its leaf.

use omo_computer_core::error::{EngineCode, Reason};
use serde::de::Error;
use serde::{Deserialize, Deserializer};

pub fn engine_code<'de, D: Deserializer<'de>>(deserializer: D) -> Result<EngineCode, D::Error> {
    let wire = String::deserialize(deserializer)?;
    EngineCode::from_wire(&wire).ok_or_else(|| D::Error::unknown_variant(&wire, &[]))
}

pub fn reason<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<Reason>, D::Error> {
    let wire = String::deserialize(deserializer)?;
    Reason::from_wire(&wire)
        .map(Some)
        .ok_or_else(|| D::Error::unknown_variant(&wire, &[]))
}
