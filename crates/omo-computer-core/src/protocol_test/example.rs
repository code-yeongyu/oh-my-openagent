//! The value the corpus walk fills a ledgered additive member with: the smallest value its
//! declared schema admits, so the members the imported reply does carry are type-checked.

use serde_json::Value;

pub(super) fn definition_name(reference: &Value) -> Option<&str> {
    reference.as_str()?.strip_prefix("#/$defs/")
}

/// The smallest value the schema node admits: the first `const` / `enum` value or branch,
/// the smallest number its range admits, a string its `pattern` matches or else one of
/// `minLength` characters, an array of its tuple members (`prefixItems`) padded to
/// `minItems` with `items`, and an object of its required members.
pub(super) fn example(schema: &Value, node: &Value) -> Value {
    if let Some(name) = definition_name(&node["$ref"]) {
        return example(schema, &schema["$defs"][name]);
    }
    if let Some(value) = node.get("const") {
        return value.clone();
    }
    if let Some(first) = node["enum"].as_array().and_then(|values| values.first()) {
        return first.clone();
    }
    for key in ["anyOf", "oneOf"] {
        if let Some(branches) = node[key].as_array() {
            let branch = branches
                .iter()
                .find(|branch| branch["type"] != "null")
                .or_else(|| branches.first());
            if let Some(branch) = branch {
                return example(schema, branch);
            }
        }
    }
    let kind = match &node["type"] {
        Value::Array(kinds) => kinds
            .iter()
            .find(|kind| *kind != "null")
            .and_then(Value::as_str)
            .unwrap_or("null"),
        kind => kind.as_str().unwrap_or("object"),
    };
    match kind {
        "string" => node["pattern"].as_str().map_or_else(
            || Value::String("a".repeat(bound(node, "minLength"))),
            |pattern| Value::String(pattern_example(pattern)),
        ),
        "integer" | "number" => number_example(node, kind == "integer"),
        "boolean" => Value::Bool(false),
        "array" => {
            let mut items: Vec<Value> = node["prefixItems"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|item| example(schema, item))
                .collect();
            while items.len() < bound(node, "minItems") {
                items.push(example(schema, &node["items"]));
            }
            Value::Array(items)
        }
        "null" => Value::Null,
        _ => Value::Object(
            node["required"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(|member| {
                    (
                        member.to_owned(),
                        example(schema, &node["properties"][member]),
                    )
                })
                .collect(),
        ),
    }
}

/// The smallest number the node admits: `minimum`, or one past `exclusiveMinimum`, or 0,
/// lowered to `maximum` (or one below `exclusiveMaximum`) when that is smaller.
fn number_example(node: &Value, integer: bool) -> Value {
    let low = node["minimum"]
        .as_f64()
        .or_else(|| node["exclusiveMinimum"].as_f64().map(|bound| bound + 1.0))
        .unwrap_or(0.0);
    let high = node["maximum"]
        .as_f64()
        .or_else(|| node["exclusiveMaximum"].as_f64().map(|bound| bound - 1.0));
    let value = high.map_or(low, |high| low.min(high));
    if integer {
        // An integer member's bounds are integers, so the value is one too.
        #[allow(clippy::cast_possible_truncation)]
        Value::from(value as i64)
    } else {
        Value::from(value)
    }
}

/// The character an escape stands for: a class (`\d`, `\w`, `\s`) is one of its members.
fn escaped(pattern: &str, next: Option<char>) -> char {
    match next {
        Some('d') => '0',
        Some('w') => 'a',
        Some('s') => ' ',
        Some(literal) if !literal.is_ascii_alphanumeric() => literal,
        _ => unsupported(pattern, "an escape class"),
    }
}

fn unsupported(pattern: &str, what: &str) -> ! {
    panic!("example(): pattern {pattern:?} uses {what}, which the corpus filler does not build")
}

/// The shortest string a pattern matches, for the subset the engine schema may use: anchors,
/// literals, escapes, `.`, `[...]` classes and the quantifiers `?`, `*`, `+`, `{n}`, `{n,}`
/// and `{n,m}`. A group, an alternation or a negated class panics with the pattern,
/// so a ledgered member the walk cannot fill fails loudly, naming why.
fn pattern_example(pattern: &str) -> String {
    let mut chars = pattern
        .strip_prefix('^')
        .unwrap_or(pattern)
        .chars()
        .peekable();
    let mut out = String::new();
    while let Some(c) = chars.next() {
        let atom = match c {
            '\\' => escaped(pattern, chars.next()),
            '[' => {
                let atom = match chars.next() {
                    Some('^') | None => unsupported(pattern, "a negated or open class"),
                    Some('\\') => escaped(pattern, chars.next()),
                    Some(first) => first,
                };
                if !chars.by_ref().any(|rest| rest == ']') {
                    unsupported(pattern, "an open class");
                }
                atom
            }
            '.' => 'a',
            '$' if chars.peek().is_none() => break,
            '(' | ')' | '|' | '$' | '^' => {
                unsupported(pattern, "a group, an alternation or an inner anchor")
            }
            literal => literal,
        };
        let count = match chars.peek() {
            Some('?' | '*') => {
                chars.next();
                0
            }
            Some('+') => {
                chars.next();
                1
            }
            Some('{') => {
                chars.next();
                let quantifier: String = chars.by_ref().take_while(|&c| c != '}').collect();
                quantifier
                    .split(',')
                    .next()
                    .and_then(|low| low.trim().parse().ok())
                    .unwrap_or_else(|| unsupported(pattern, "a malformed quantifier"))
            }
            _ => 1,
        };
        out.extend(std::iter::repeat_n(atom, count));
    }
    out
}

/// A `minLength` / `minItems` bound of a schema node; 0 when it has none.
fn bound(node: &Value, key: &str) -> usize {
    node[key]
        .as_u64()
        .and_then(|value| usize::try_from(value).ok())
        .unwrap_or(0)
}

/// A ledgered member is filled with a value its declared type admits, including a
/// `minLength` string, a `minItems` array and a tuple (`prefixItems`).
#[test]
fn a_filled_member_meets_its_length_and_tuple_bounds() {
    #[derive(serde::Deserialize, schemars::JsonSchema)]
    #[allow(dead_code)]
    struct Bounded {
        #[schemars(length(min = 3))]
        name: String,
        #[schemars(length(min = 2))]
        list: Vec<u8>,
        pair: (u8, String),
    }
    let mut generator = schemars::SchemaGenerator::default();
    let reference = generator.subschema_for::<Bounded>().to_value();
    let schema = serde_json::json!({"$defs": generator.definitions().clone()});
    let filled = example(&schema, &reference);
    assert!(
        filled["name"]
            .as_str()
            .is_some_and(|name| name.chars().count() >= 3),
        "name ignores minLength: {filled}"
    );
    assert!(
        filled["list"]
            .as_array()
            .is_some_and(|list| list.len() >= 2),
        "list ignores minItems: {filled}"
    );
    serde_json::from_value::<Bounded>(filled.clone()).unwrap_or_else(|error| {
        panic!("the filled value does not fit its type: {error}: {filled}")
    });
}

/// A filled ledgered member also meets `exclusiveMinimum`, `maximum` and `pattern`.
#[test]
fn a_filled_member_meets_its_range_and_pattern_bounds() {
    let schema = serde_json::json!({"$defs": {}});
    let node = serde_json::json!({
        "type": "object",
        "required": ["count", "level", "ratio", "digest", "reference"],
        "properties": {
            "count": {"type": "integer", "exclusiveMinimum": 0},
            "level": {"type": "integer", "maximum": -3},
            "ratio": {"type": "number", "minimum": 0.5, "maximum": 0.75},
            "digest": {"type": "string", "pattern": "^[a-f0-9]{16}$"},
            "reference": {"type": "string", "pattern": "^s\\d+:e\\d+$"},
        },
    });
    let filled = example(&schema, &node);
    assert!(
        filled["count"].as_i64().is_some_and(|count| count > 0),
        "count ignores exclusiveMinimum: {filled}"
    );
    assert!(
        filled["level"].as_i64().is_some_and(|level| level <= -3),
        "level ignores maximum: {filled}"
    );
    assert!(
        filled["ratio"]
            .as_f64()
            .is_some_and(|ratio| (0.5..=0.75).contains(&ratio)),
        "ratio ignores its range: {filled}"
    );
    let digest = filled["digest"].as_str().unwrap_or_default();
    assert!(
        digest.len() == 16
            && digest
                .chars()
                .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()),
        "digest ignores its pattern: {filled}"
    );
    assert_eq!(
        filled["reference"], "s0:e0",
        "reference ignores its pattern: {filled}"
    );
}
