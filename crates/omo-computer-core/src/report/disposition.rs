//! `Disposition{delivery, retry}`: whether input reached the target and whether the same
//! request may be sent again. Five delivery classes and four retry values make twenty
//! pairs; exactly seven are valid. A `Disposition` value is always one of the seven: the
//! fields are private, the one constructor checks the pair, and the wire parse goes
//! through the same check.

use std::borrow::Cow;
use std::fmt;

use schemars::{json_schema, JsonSchema, Schema, SchemaGenerator};
use serde::{Deserialize, Serialize};

/// Whether input reached the target.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Delivery {
    /// Nothing reached the operating system.
    NotDelivered,
    /// Some or all of the input may have reached the target; the engine cannot tell.
    DeliveryUncertain,
    /// The input was delivered and no receipt proved that the target consumed it.
    DeliveredUnverified,
    /// The input was delivered and a receipt-class evidence entry proves it.
    DeliveredVerified,
    /// The engine cannot say what happened.
    Unknown,
}

impl Delivery {
    pub const ALL: [Self; 5] = [
        Self::NotDelivered,
        Self::DeliveryUncertain,
        Self::DeliveredUnverified,
        Self::DeliveredVerified,
        Self::Unknown,
    ];

    /// The wire spelling.
    #[must_use]
    pub const fn wire(self) -> &'static str {
        match self {
            Self::NotDelivered => "not_delivered",
            Self::DeliveryUncertain => "delivery_uncertain",
            Self::DeliveredUnverified => "delivered_unverified",
            Self::DeliveredVerified => "delivered_verified",
            Self::Unknown => "unknown",
        }
    }
}

/// Whether the same request may be sent again.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Retry {
    /// Sending again cannot duplicate input.
    Safe,
    /// Only after the human acts.
    AfterUser,
    /// Sending again may duplicate input: read the target first.
    Unsafe,
    /// The engine cannot tell.
    Unknown,
}

impl Retry {
    pub const ALL: [Self; 4] = [Self::Safe, Self::AfterUser, Self::Unsafe, Self::Unknown];

    /// The wire spelling.
    #[must_use]
    pub const fn wire(self) -> &'static str {
        match self {
            Self::Safe => "safe",
            Self::AfterUser => "after_user",
            Self::Unsafe => "unsafe",
            Self::Unknown => "unknown",
        }
    }
}

/// One of the seven valid `(delivery, retry)` pairs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "WireDisposition")]
pub struct Disposition {
    delivery: Delivery,
    retry: Retry,
}

/// A `(delivery, retry)` pair outside the seven.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InvalidDisposition {
    pub delivery: Delivery,
    pub retry: Retry,
}

impl fmt::Display for InvalidDisposition {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "disposition {}/{} is not one of the seven valid pairs",
            self.delivery.wire(),
            self.retry.wire()
        )
    }
}

impl std::error::Error for InvalidDisposition {}

impl Disposition {
    pub const NOT_DELIVERED_SAFE: Self = Self::pair(Delivery::NotDelivered, Retry::Safe);
    pub const NOT_DELIVERED_AFTER_USER: Self = Self::pair(Delivery::NotDelivered, Retry::AfterUser);
    pub const UNCERTAIN_UNSAFE: Self = Self::pair(Delivery::DeliveryUncertain, Retry::Unsafe);
    pub const UNCERTAIN_UNKNOWN: Self = Self::pair(Delivery::DeliveryUncertain, Retry::Unknown);
    pub const DELIVERED_UNVERIFIED: Self = Self::pair(Delivery::DeliveredUnverified, Retry::Unsafe);
    pub const DELIVERED_VERIFIED: Self = Self::pair(Delivery::DeliveredVerified, Retry::Unsafe);
    pub const UNKNOWN: Self = Self::pair(Delivery::Unknown, Retry::Unknown);

    /// The seven valid pairs.
    pub const ALL: [Self; 7] = [
        Self::NOT_DELIVERED_SAFE,
        Self::NOT_DELIVERED_AFTER_USER,
        Self::UNCERTAIN_UNSAFE,
        Self::UNCERTAIN_UNKNOWN,
        Self::DELIVERED_UNVERIFIED,
        Self::DELIVERED_VERIFIED,
        Self::UNKNOWN,
    ];

    /// The only path from two values to a `Disposition` outside this module.
    ///
    /// # Errors
    /// `InvalidDisposition` for each of the thirteen pairs outside the seven.
    pub const fn new(delivery: Delivery, retry: Retry) -> Result<Self, InvalidDisposition> {
        if Self::is_valid(delivery, retry) {
            Ok(Self { delivery, retry })
        } else {
            Err(InvalidDisposition { delivery, retry })
        }
    }

    /// `not_delivered` pairs with `safe` or `after_user`; `delivery_uncertain` with `unsafe`
    /// or `unknown`; both delivered classes with `unsafe` only; `unknown` with `unknown`.
    #[must_use]
    pub const fn is_valid(delivery: Delivery, retry: Retry) -> bool {
        matches!(
            (delivery, retry),
            (Delivery::NotDelivered, Retry::Safe | Retry::AfterUser)
                | (Delivery::DeliveryUncertain, Retry::Unsafe | Retry::Unknown)
                | (
                    Delivery::DeliveredUnverified | Delivery::DeliveredVerified,
                    Retry::Unsafe
                )
                | (Delivery::Unknown, Retry::Unknown)
        )
    }

    #[must_use]
    pub const fn delivery(self) -> Delivery {
        self.delivery
    }

    #[must_use]
    pub const fn retry(self) -> Retry {
        self.retry
    }

    /// For the named constants only: every call site passes one of the seven.
    const fn pair(delivery: Delivery, retry: Retry) -> Self {
        Self { delivery, retry }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireDisposition {
    delivery: Delivery,
    retry: Retry,
}

impl TryFrom<WireDisposition> for Disposition {
    type Error = InvalidDisposition;

    fn try_from(wire: WireDisposition) -> Result<Self, Self::Error> {
        Self::new(wire.delivery, wire.retry)
    }
}

impl JsonSchema for Disposition {
    fn schema_name() -> Cow<'static, str> {
        Cow::Borrowed("Disposition")
    }

    fn json_schema(_: &mut SchemaGenerator) -> Schema {
        let pairs: Vec<serde_json::Value> = Self::ALL
            .iter()
            .map(|pair| {
                serde_json::json!({
                    "type": "object",
                    "properties": {
                        "delivery": { "const": pair.delivery.wire() },
                        "retry": { "const": pair.retry.wire() }
                    },
                    "required": ["delivery", "retry"],
                    "additionalProperties": false
                })
            })
            .collect();
        json_schema!({
            "description": "Whether input reached the target and whether the same request may be sent again: exactly one of the seven valid (delivery, retry) pairs.",
            "oneOf": pairs
        })
    }
}
