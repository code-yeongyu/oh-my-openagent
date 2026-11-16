//! The typed refusal every default backend method answers with. Nothing is sent on a
//! refusal: a default never reaches the OS.

use crate::error::{self, ComputerCode, EngineCode, ErrorRow, UnknownFailure};

/// A refusal before any send: `nothingSent` is always true. `code` is one of the closed
/// engine codes and `reason` its `data.reason` token, or `None` for a bare refusal; the
/// pair maps to its `COMPUTER_*` row through the one error table.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Refusal {
    pub code: EngineCode,
    pub reason: Option<&'static str>,
    /// Extra members of the wire's `data` object (R52), e.g. a JSON pointer; `None` for every
    /// refusal that names none, which keeps its wire form unchanged.
    pub data: Option<Box<serde_json::Value>>,
}

impl Refusal {
    /// A refusal carrying `reason` as its `data.reason`.
    #[must_use]
    pub const fn new(code: EngineCode, reason: &'static str) -> Self {
        Self {
            code,
            reason: Some(reason),
            data: None,
        }
    }

    /// A refusal with no `data.reason`: it resolves to the code's bare row.
    #[must_use]
    pub const fn bare(code: EngineCode) -> Self {
        Self { code, reason: None, data: None }
    }

    /// The same refusal carrying `data`'s members beside `code`, `hint` and `reason`.
    #[must_use]
    pub fn with_data(mut self, data: serde_json::Value) -> Self {
        self.data = Some(Box::new(data));
        self
    }

    /// The wire's `data` object: `code`, `hint: null`, `reason` when there is one, then the
    /// refusal's own members; a member may not replace those three.
    #[must_use]
    pub fn wire_data(&self) -> serde_json::Value {
        let mut data = serde_json::json!({ "code": self.code.wire(), "hint": null });
        if let Some(reason) = self.reason {
            data["reason"] = serde_json::json!(reason);
        }
        if let Some(serde_json::Value::Object(extra)) = self.data.as_deref() {
            for (key, value) in extra {
                if !["code", "hint", "reason"].contains(&key.as_str()) {
                    data[key.as_str()] = value.clone();
                }
            }
        }
        data
    }

    /// The table row of `(code, reason)`, or the code's bare row when there is no reason.
    ///
    /// # Errors
    /// `UnknownFailure` when the reason token or the pair has no row.
    pub fn row(&self) -> Result<&'static ErrorRow, UnknownFailure> {
        error::from_wire(self.code.number(), self.reason)
    }

    /// The `COMPUTER_*` member the tool and the adapter show.
    ///
    /// # Errors
    /// `UnknownFailure` when the pair has no row.
    pub fn computer_code(&self) -> Result<ComputerCode, UnknownFailure> {
        self.row().map(|row| row.computer)
    }
}

/// The result of every fallible backend method.
pub type BackendResult<T> = Result<T, Refusal>;

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::Refusal;
    use crate::error::{rows, EngineCode, Source};

    /// The wire `data` every refusal had before R52: code, hint, and reason when present.
    fn before(refusal: &Refusal) -> String {
        let mut data = json!({ "code": refusal.code.wire(), "hint": null });
        if let Some(reason) = refusal.reason {
            data["reason"] = json!(reason);
        }
        data.to_string()
    }

    #[test]
    fn every_existing_refusal_keeps_its_wire_form() {
        let mut checked = 0;
        for row in rows() {
            let Source::Engine(code) = row.key.source else { continue };
            let refusal = row.key.reason.map_or_else(|| Refusal::bare(code), |r| Refusal::new(code, r.wire()));
            assert_eq!(refusal.wire_data().to_string(), before(&refusal), "{:?}", row.key);
            checked += 1;
        }
        assert!(checked > 100, "every engine row of the table: {checked}");
    }

    #[test]
    fn data_members_join_the_wire_object_and_never_replace_its_own() {
        let refusal = Refusal::new(EngineCode::Internal, "route_table_invalid")
            .with_data(json!({ "pointer": "/routes/1/class", "reason": "spoofed", "code": "spoofed" }));
        assert_eq!(
            refusal.wire_data(),
            json!({ "code": "Internal", "hint": null, "reason": "route_table_invalid", "pointer": "/routes/1/class" })
        );
    }
}
