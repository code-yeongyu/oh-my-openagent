//! A JSON Schema validator for the draft-07 subset schemars emits, used by
//! the conformance tests. An unsupported keyword is an error, so a schema
//! change can never make validation vacuous.

use serde_json::{json, Map, Value};

/// Validates values against subschemas of `root`, resolving `$ref`s in it.
pub(super) struct Validator<'a> {
    pub(super) root: &'a Value,
}

pub(super) fn definition(name: &str) -> Value {
    json!({ "$ref": format!("#/definitions/{name}") })
}

fn has_type(name: &str, value: &Value) -> bool {
    match name {
        "null" => value.is_null(),
        "boolean" => value.is_boolean(),
        "object" => value.is_object(),
        "array" => value.is_array(),
        "string" => value.is_string(),
        "number" => value.is_number(),
        "integer" => value.is_i64() || value.is_u64(),
        _ => false,
    }
}

impl Validator<'_> {
    pub(super) fn check(&self, schema: &Value, value: &Value, at: &str) -> Result<(), String> {
        let rules = match schema {
            Value::Bool(true) => return Ok(()),
            Value::Object(rules) => rules,
            other => return Err(format!("{at}: schema {other} admits nothing")),
        };
        for (keyword, rule) in rules {
            self.check_keyword(rules, (keyword, rule), value, at)?;
        }
        Ok(())
    }

    fn check_keyword(
        &self,
        rules: &Map<String, Value>,
        (keyword, rule): (&String, &Value),
        value: &Value,
        at: &str,
    ) -> Result<(), String> {
        let fail = |what: &str| Err(format!("{at}: {what} (value {value})"));
        let options = || rule.as_array().into_iter().flatten();
        match keyword.as_str() {
            "$ref" => {
                let pointer = rule.as_str().and_then(|reference| reference.strip_prefix('#'));
                let target = pointer.and_then(|pointer| self.root.pointer(pointer));
                return target.map_or_else(|| fail("dangling $ref"), |target| self.check(target, value, at));
            }
            "type" => {
                let names: Vec<&str> = rule.as_str().map_or_else(
                    || options().filter_map(Value::as_str).collect(),
                    |name| vec![name],
                );
                if !names.iter().any(|name| has_type(name, value)) {
                    return fail(&format!("not of type {rule}"));
                }
            }
            "enum" if !options().any(|option| option == value) => return fail(&format!("not one of {rule}")),
            "const" if rule != value => return fail(&format!("not {rule}")),
            "properties" | "additionalProperties" | "required" => {
                if let Value::Object(members) = value {
                    self.check_members(rules, (keyword, rule), members, at)?;
                }
            }
            "items" => {
                for (index, item) in value.as_array().into_iter().flatten().enumerate() {
                    let item_schema = rule.as_array().map_or(Some(rule), |tuple| tuple.get(index));
                    let item_schema = item_schema.unwrap_or(&Value::Bool(false));
                    self.check(item_schema, item, &format!("{at}/{index}"))?;
                }
            }
            "minItems" | "maxItems" | "minimum" | "maximum" => {
                let actual = value.as_array().map_or_else(
                    || value.as_f64(),
                    |items| Some(f64::from(u32::try_from(items.len()).unwrap_or(u32::MAX))),
                );
                let bound = rule.as_f64().unwrap_or(f64::NAN);
                let within = actual.is_none_or(|actual| match keyword.as_str() {
                    "minItems" | "minimum" => actual >= bound,
                    _ => actual <= bound,
                });
                if !within {
                    return fail(&format!("violates {keyword} {rule}"));
                }
            }
            "anyOf" | "oneOf" => {
                let results: Vec<Result<(), String>> =
                    options().map(|option| self.check(option, value, at)).collect();
                let passed = results.iter().filter(|result| result.is_ok()).count();
                if passed == 0 || (keyword == "oneOf" && passed > 1) {
                    let reasons: Vec<String> = results.into_iter().filter_map(Result::err).collect();
                    return fail(&format!(
                        "{passed} {keyword} branches match: [{}]",
                        reasons.join(" | ")
                    ));
                }
            }
            "allOf" => {
                for option in options() {
                    self.check(option, value, at)?;
                }
            }
            "enum" | "const" | "$schema" | "title" | "description" | "format" | "default" => {}
            unsupported => return fail(&format!("unsupported schema keyword `{unsupported}`")),
        }
        Ok(())
    }

    fn check_members(
        &self,
        rules: &Map<String, Value>,
        (keyword, rule): (&String, &Value),
        members: &Map<String, Value>,
        at: &str,
    ) -> Result<(), String> {
        let named = rules.get("properties").and_then(Value::as_object);
        for (name, member) in members {
            let at = format!("{at}/{name}");
            match (keyword.as_str(), named.and_then(|named| named.get(name))) {
                ("properties", Some(property)) => self.check(property, member, &at)?,
                ("additionalProperties", None) => self.check(rule, member, &at)?,
                _ => {}
            }
        }
        let required = rule.as_array().into_iter().flatten().filter_map(Value::as_str);
        match required
            .filter(|_| keyword == "required")
            .find(|name| !members.contains_key(*name))
        {
            Some(missing) => Err(format!("{at}: missing required member `{missing}`")),
            None => Ok(()),
        }
    }
}
