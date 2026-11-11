//! Generates `docs/engine-protocol.md` from the method table, the env seam list and the
//! settings table. `protocol_test::protocol_doc_is_fresh` fails until it is regenerated.

use std::fmt::Write as _;

use crate::env::ENV_SEAMS;
use crate::hello::{ABI, PROTOCOL_VERSION};
use crate::methods::{METHODS, ONESHOT_ALIASES, ONESHOT_PREFIX};
use crate::settings::SETTINGS_TABLE;

/// The doc file, relative to the crate root.
pub const DOC_PATH: &str = "docs/engine-protocol.md";

fn cell(text: &str) -> String {
    text.replace('|', "\\|")
}

/// The protocol doc's exact text.
#[must_use]
pub fn protocol_doc() -> String {
    let mut doc = String::new();
    let _ = writeln!(doc, "# omo-computer engine protocol\n");
    let _ = writeln!(
        doc,
        "Generated from `crates/omo-computer-core/src/methods/table.rs`; do not edit by hand."
    );
    let _ = writeln!(
        doc,
        "Regenerate with `OMO_COMPUTER_UPDATE_SCHEMA=1 cargo test -p omo-computer-core`.\n"
    );
    let _ = writeln!(doc, "JSON-RPC 2.0, one object per line (NDJSON), UTF-8. Protocol version `\"{PROTOCOL_VERSION}\"`, ABI `{ABI}` (compared by major).");
    let _ = writeln!(doc, "`engine.hello` is the first frame on every connection. Schema: `schema/engine.schema.json`.\n");
    let _ = writeln!(doc, "A one-shot call names a method with the `{ONESHOT_PREFIX}` prefix (`{ONESHOT_PREFIX}click` calls `click`).");
    for (alias, method) in ONESHOT_ALIASES {
        let _ = writeln!(doc, "The one-shot `{alias}` calls `{method}`.");
    }
    let _ = writeln!(
        doc,
        "\n## Methods\n\n| method | effect | exposure | params | result |\n|---|---|---|---|---|"
    );
    for spec in METHODS {
        let effect = match spec.effect {
            crate::methods::Effect::Read => "read",
            crate::methods::Effect::Exec => "exec",
        };
        let _ = writeln!(
            doc,
            "| `{}` | {effect} | {} | `{}` | `{}` |",
            spec.name,
            spec.exposure.label(),
            cell(spec.params),
            cell(spec.result)
        );
    }
    let _ = writeln!(doc, "\n## Environment seams\n\nNo other `OMO_COMPUTER_*` variable is read; a fake-only seam with a real backend refuses the launch.\n");
    let _ = writeln!(
        doc,
        "| variable | read | fake only | purpose |\n|---|---|---|---|"
    );
    for seam in ENV_SEAMS {
        let phase = serde_json::to_value(seam.phase)
            .ok()
            .and_then(|value| value.as_str().map(str::to_owned))
            .unwrap_or_default();
        let _ = writeln!(
            doc,
            "| `{}` | {phase} | {} | {} |",
            seam.name,
            if seam.fake_only { "yes" } else { "no" },
            cell(seam.purpose)
        );
    }
    let _ = writeln!(doc, "\n## Settings (`session.open{{settings}}`)\n\n| key | status | reader | admission key |\n|---|---|---|---|");
    for row in SETTINGS_TABLE {
        let status = serde_json::to_value(row.status)
            .ok()
            .and_then(|value| value.as_str().map(str::to_owned))
            .unwrap_or_default();
        let _ = writeln!(
            doc,
            "| `computer.{}` | {status} | {} | {} |",
            row.key,
            cell(row.reader),
            if row.admission_key { "yes" } else { "no" }
        );
    }
    doc
}
