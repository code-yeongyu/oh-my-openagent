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
