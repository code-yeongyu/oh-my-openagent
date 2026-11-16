use omo_computer_backend_fake::Persona;
use omo_computer_core::params::{ClickParams, TypeTextParams};
use serde_json::Value;

use super::{params, Run};
use crate::audit::sha256_16;
use crate::Session;

const CASE: &str = include_str!(
    "../../../../omo-computer-core/fixtures/conformance/v3-secure-field-type-audit-length-only-no-hash.json"
);
const SECURE_SCENARIO: &str =
    include_str!("../../../../omo-computer-backend-fake/fixtures/v3-secure-focus.json");

/// The case's exec steps, replayed in process (the driver replays its replies on the engine).
fn replay(session: &mut Session, case: &Value) {
    for step in case["steps"].as_array().expect("steps") {
        let send = &step["send"];
        let params_of = || send["params"].clone();
        match send["method"].as_str().expect("method") {
            "session.open" | "stopPath.start" => {}
            "typeText" => {
                session
                    .type_text(params::<TypeTextParams>(params_of()))
                    .expect("typed");
            }
            "click" => {
                session
                    .click(params::<ClickParams>(params_of()))
                    .expect("clicked");
            }
            other => panic!("the case sends {other}, which this replay does not drive"),
        }
    }
}

#[test]
fn secure_field_type_audit_keeps_length_only_and_no_digest() {
    let case: Value = serde_json::from_str(CASE).expect("case JSON");
    let secret = case["steps"]
        .as_array()
        .expect("steps")
        .iter()
        .find(|step| step["send"]["method"] == "typeText")
        .and_then(|step| step["send"]["params"]["text"].as_str())
        .expect("the case types a secret")
        .to_owned();
    let digest = sha256_16(secret.as_bytes());
    for persona in [Persona::Macos, Persona::X11, Persona::Wayland] {
        let run = Run::new();
        let backend = Box::new(run.fake_of(SECURE_SCENARIO, persona));
        let session = Session::for_roots(backend, &run.roots());
        let mut session = super::open(
            session.with_secure_probe(Box::new(|target: Option<&str>| target == Some("101"))),
        );
        replay(&mut session, &case);
        let typed: Vec<Value> = run
            .audit_lines()
            .into_iter()
            .filter(|line| line["action"] == "typeText")
            .collect();
        assert_eq!(typed.len(), 1, "{persona:?}");
        let line = &typed[0];
        assert_eq!(
            line["text"],
            serde_json::json!({ "length": secret.chars().count() }),
            "{persona:?}: {line}"
        );
        assert_eq!(
            line["warnings"],
            serde_json::json!(["redacted_secure"]),
            "{persona:?}"
        );
        assert!(line.get("keys").is_none(), "{persona:?}");
        let written = run.everything_written();
        assert!(
            !written.contains(&secret),
            "{persona:?}: the secret is on disk"
        );
        assert!(
            !written.contains(&digest[..8]),
            "{persona:?}: a digest prefix of the secret is on disk"
        );
        assert!(
            !run.marker_file().exists() || !run.marker()["text"].to_string().contains("sha256_16"),
            "{persona:?}"
        );
    }
}

/// Review L1 of #13373 at 4d3d6227f5: a funnel pass refused before it takes the secure decision
/// leaves no decision behind, so a multi-pass call never hands the wire audit an earlier
/// pass's answer.
#[test]
fn a_pass_refused_before_the_secure_decision_leaves_none() {
    let run = Run::new();
    let backend = Box::new(run.fake_of(SECURE_SCENARIO, Persona::Macos));
    let session = Session::for_roots(backend, &run.roots());
    let mut session = super::open(session.with_secure_probe(Box::new(|_: Option<&str>| false)));
    let click = serde_json::json!({"target": "101", "x": 10, "y": 10});
    session.click(params::<ClickParams>(click.clone())).expect("clicked");
    session.close();
    session.click(params::<ClickParams>(click)).expect_err("a closed session refuses");
    assert_eq!(session.take_call_secure(), None, "the refused pass left an earlier decision");
}
