use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::types::PointerOptions;

/// `holdKeys`: keys are always released before the request settles.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct HoldKeysParams {
    pub target: String,
    pub keys: Vec<String>,
    #[serde(deserialize_with = "duration")]
    #[schemars(with = "f64")]
    pub duration: f64,
    pub opts: Option<PointerOptions>,
}

/// `holdMouse`: coordinates address the latest full capture, never a zoom.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct HoldMouseParams {
    pub target: String,
    pub x: f64,
    pub y: f64,
    #[serde(deserialize_with = "duration")]
    #[schemars(with = "f64")]
    pub duration: f64,
    pub button: Option<String>,
    pub keys: Option<Vec<String>>,
    pub frame_id: Option<String>,
    pub opts: Option<PointerOptions>,
}

fn duration<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<f64, D::Error> {
    let seconds = f64::deserialize(deserializer)?;
    if !seconds.is_finite() || !(0.0..=100.0).contains(&seconds) {
        return Err(serde::de::Error::custom("hold duration must be finite seconds in 0..=100"));
    }
    Ok(seconds)
}
