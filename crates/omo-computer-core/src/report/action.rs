//! `ActionReport`: the reply of every exec verb in an object-mode session. Its members are
//! private: a report exists only through `ActionReport::new`, which runs the per-(verb,
//! report) wire validation, or through the wire parse, which runs every rule that holds
//! for every verb. A `confirmed` report without a receipt therefore cannot be built.

use std::borrow::Cow;

use schemars::{JsonSchema, Schema, SchemaGenerator};
use serde::{Deserialize, Serialize};

use crate::listing::Surface;
use crate::untrusted::UntrustedText;

use super::disposition::Disposition;
use super::effect::{Delivered, Effect, FocusRestoration, Hit, Route, Timings};
use super::evidence::Evidence;
use super::rejection::ReportRejection;
use super::shape::{check, Shape};
use super::verb::ReportContext;

/// Everything a report says, before validation.
#[derive(Debug, Clone, PartialEq, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ReportParts {
    pub disposition: Disposition,
    #[serde(default)]
    pub delivered: Option<Delivered>,
    pub effect: Effect,
    pub route: Route,
    #[serde(default)]
    pub hit: Option<Hit>,
    #[serde(default)]
    pub focus_restoration: Option<FocusRestoration>,
    #[serde(default)]
    pub opened_surfaces: Vec<Surface>,
    #[serde(default)]
    pub next_call: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub warning: Option<String>,
    #[serde(default)]
    pub audit_ids: Vec<String>,
    #[serde(default)]
    pub timings: Option<Timings>,
    pub evidence: Vec<Evidence>,
    /// Required on the wire: a report without `{untrustedText: true}` does not parse.
    pub observation: UntrustedText,
}

/// A validated `ActionReport`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(try_from = "ReportParts", rename_all = "camelCase")]
pub struct ActionReport {
    disposition: Disposition,
    #[serde(skip_serializing_if = "Option::is_none")]
    delivered: Option<Delivered>,
    effect: Effect,
    route: Route,
    #[serde(skip_serializing_if = "Option::is_none")]
    hit: Option<Hit>,
    #[serde(skip_serializing_if = "Option::is_none")]
    focus_restoration: Option<FocusRestoration>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    opened_surfaces: Vec<Surface>,
    #[serde(skip_serializing_if = "Option::is_none")]
    next_call: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    warning: Option<String>,
    audit_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    timings: Option<Timings>,
    evidence: Vec<Evidence>,
    observation: UntrustedText,
}

impl ActionReport {
    /// Builds a report for one (verb, report) pair.
    ///
    /// # Errors
    /// The typed rejection of the first rule the shape breaks.
    pub fn new(context: ReportContext, parts: ReportParts) -> Result<Self, ReportRejection> {
        check(&shape_of(&parts), Some(context))?;
        Ok(Self::from_checked(parts))
    }

    /// Re-runs wire validation of a parsed report under its (verb, platform) key.
    ///
    /// # Errors
    /// The typed rejection of the first rule the shape breaks.
    pub fn validate(&self, context: ReportContext) -> Result<(), ReportRejection> {
        check(
            &Shape {
                disposition: self.disposition,
                effect: self.effect,
                delivered: self.delivered,
                evidence: &self.evidence,
            },
            Some(context),
        )
    }

    #[must_use]
    pub const fn disposition(&self) -> Disposition {
        self.disposition
    }

    #[must_use]
    pub const fn effect(&self) -> Effect {
        self.effect
    }

    #[must_use]
    pub const fn delivered(&self) -> Option<Delivered> {
        self.delivered
    }

    #[must_use]
    pub const fn route(&self) -> Route {
        self.route
    }

    #[must_use]
    pub const fn focus_restoration(&self) -> Option<FocusRestoration> {
        self.focus_restoration
    }

    #[must_use]
    pub fn evidence(&self) -> &[Evidence] {
        &self.evidence
    }

    #[must_use]
    pub fn audit_ids(&self) -> &[String] {
        &self.audit_ids
    }

    fn from_checked(parts: ReportParts) -> Self {
        Self {
            disposition: parts.disposition,
            delivered: parts.delivered,
            effect: parts.effect,
            route: parts.route,
            hit: parts.hit,
            focus_restoration: parts.focus_restoration,
            opened_surfaces: parts.opened_surfaces,
            next_call: parts.next_call,
            note: parts.note,
            warning: parts.warning,
            audit_ids: parts.audit_ids,
            timings: parts.timings,
            evidence: parts.evidence,
            observation: parts.observation,
        }
    }
}

fn shape_of(parts: &ReportParts) -> Shape<'_> {
    Shape {
        disposition: parts.disposition,
        effect: parts.effect,
        delivered: parts.delivered,
        evidence: &parts.evidence,
    }
}

impl TryFrom<ReportParts> for ActionReport {
    type Error = ReportRejection;

    fn try_from(parts: ReportParts) -> Result<Self, Self::Error> {
        check(&shape_of(&parts), None)?;
        Ok(Self::from_checked(parts))
    }
}

impl JsonSchema for ActionReport {
    fn schema_name() -> Cow<'static, str> {
        Cow::Borrowed("ActionReport")
    }

    fn json_schema(generator: &mut SchemaGenerator) -> Schema {
        ReportParts::json_schema(generator)
    }
}
