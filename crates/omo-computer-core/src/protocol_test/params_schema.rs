//! The published params schema of the exec verbs: the exec members every public exec verb
//! carries, and the x/y pairing of `click` and `mouse.down`.

use super::crate_path;
use crate::methods::{Effect, Exposure, METHODS};
use crate::schema::{engine_schema, SCHEMA_PATH};

/// Every public exec verb is bound to its call (`callId`, `runGeneration`) and takes
/// `observeAfter`, and no exec verb decodes through a read method's params.
#[test]
fn public_exec_params_carry_the_exec_members() {
    let schema = engine_schema();
    let mut problems = Vec::new();
    for spec in METHODS
        .iter()
        .filter(|spec| spec.effect == Effect::Exec && spec.exposure == Exposure::Public)
    {
        let name = spec.params;
        for member in ["callId", "runGeneration", "observeAfter"] {
            if schema["$defs"][name]["properties"].get(member).is_none() {
                problems.push(format!("{}: {name} has no {member}", spec.name));
            }
        }
        for read in METHODS
            .iter()
            .filter(|read| read.effect == Effect::Read && read.params == name)
        {
            problems.push(format!(
                "{}: {name} is also the params of the read method {}",
                spec.name, read.name
            ));
        }
    }
    assert!(problems.is_empty(), "{}", problems.join("\n"));
}

/// The paired params decode through a private wire struct (`#[serde(try_from)]`), but the
/// schema schemars generates is still the params' own: named after them, equal to the
/// committed copy, and no wire struct leaks into `$defs`. `schema_is_fresh` checks the whole
/// file; this names the two types it depends on.
#[test]
fn paired_params_publish_their_own_schema() {
    let generated = engine_schema();
    let committed: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(crate_path(SCHEMA_PATH)).expect("committed schema"),
    )
    .expect("committed schema is JSON");
    for (method, name) in [("click", "ClickParams"), ("mouse.down", "MouseDownParams")] {
        assert_eq!(
            generated["methods"][method]["params"]["$ref"],
            format!("#/$defs/{name}"),
            "{method} params are not published as {name}"
        );
        assert_eq!(
            generated["$defs"][name], committed["$defs"][name],
            "{name} differs from the committed schema"
        );
        for member in ["x", "y", "callId", "runGeneration", "observeAfter"] {
            assert!(
                generated["$defs"][name]["properties"].get(member).is_some(),
                "{name} has no {member}"
            );
        }
    }
    let leaked: Vec<&String> = generated["$defs"]
        .as_object()
        .expect("$defs")
        .keys()
        .filter(|name| name.ends_with("Wire"))
        .collect();
    assert!(leaked.is_empty(), "wire structs in $defs: {leaked:?}");
}

/// The x/y pairing is published, not only enforced at decode: `dependentRequired` makes
/// each coordinate require the other, so a schema-driven client cannot build `{x: 5}`.
#[test]
fn paired_coordinates_are_published_as_dependent_required() {
    let schema = engine_schema();
    for name in ["ClickParams", "MouseDownParams"] {
        assert_eq!(
            schema["$defs"][name]["dependentRequired"],
            serde_json::json!({"x": ["y"], "y": ["x"]}),
            "{name} does not publish the x/y pairing"
        );
    }
}

/// Review L1 (#13140): the decoder, the published schema and the generated types agree on a
/// paired coordinate. This table is checked against the decoder and against the schema's own
/// keywords for the pair (each member's type and `dependentRequired`); the generated types
/// carry the same table as type-level cases in packages/omo-computer-protocol's test.
#[test]
fn paired_coordinates_decoder_and_schema_agree_on_every_case() {
    use serde_json::{json, Value};
    let schema = engine_schema();
    // What the published schema says about one object's x and y.
    let schema_accepts = |name: &str, params: &Value| -> bool {
        let def = &schema["$defs"][name];
        let allows = |member: &str, value: &Value| -> bool {
            let types: Vec<&str> = match &def["properties"][member]["type"] {
                Value::String(one) => vec![one.as_str()],
                Value::Array(many) => many.iter().filter_map(Value::as_str).collect(),
                _ => Vec::new(),
            };
            match value {
                Value::Null => types.contains(&"null"),
                Value::Number(_) => types.contains(&"number"),
                _ => false,
            }
        };
        let present = |member: &str| params.get(member).is_some();
        let typed = ["x", "y"].iter().all(|m| params.get(*m).is_none_or(|v| allows(m, v)));
        let paired = def["dependentRequired"]
            .as_object()
            .is_none_or(|deps| deps.iter().all(|(k, needs)| !present(k) || needs.as_array().is_some_and(|n| n.iter().filter_map(Value::as_str).all(present))));
        typed && paired
    };
    let cases: [(&str, Value, bool); 5] = [
        ("x and y given", json!({"x": 5, "y": 6}), true),
        ("neither", json!({}), true),
        ("x given, y null", json!({"x": 5, "y": null}), false),
        ("x null alone", json!({"x": null}), false),
        ("x alone", json!({"x": 5}), false),
    ];
    for name in ["ClickParams", "MouseDownParams"] {
        for (case, coordinates, expected) in &cases {
            let mut params = json!({"target": "101"});
            params.as_object_mut().expect("object").extend(coordinates.as_object().expect("object").clone());
            let decoded = if name == "ClickParams" {
                serde_json::from_value::<crate::params::ClickParams>(params.clone()).is_ok()
            } else {
                serde_json::from_value::<crate::params::MouseDownParams>(params.clone()).is_ok()
            };
            assert_eq!(decoded, *expected, "{name} decoder, {case}");
            assert_eq!(schema_accepts(name, &params), *expected, "{name} schema, {case}");
        }
    }
}
