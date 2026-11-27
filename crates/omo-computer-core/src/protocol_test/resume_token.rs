//! A reply's `resumeToken` is random per engine process, and every case marks
//! `/result/resumeToken` variable, so no case compares its value. A literal token in a case only
//! reads as a high-entropy secret to the secret scanner, and a dev merge carries it into every
//! open branch as a new incident. Every case therefore pins the placeholder.

use super::corpus::cases;

const PLACEHOLDER: &str = "per-process-random";

#[test]
fn every_case_pins_the_resume_token_placeholder() {
    let mut literal = Vec::new();
    for case in cases() {
        for (index, step) in case.steps.iter().enumerate() {
            for expect in step["expect"].as_array().into_iter().flatten() {
                let token = expect["message"]["result"]["resumeToken"].as_str();
                if token.is_some_and(|token| token != PLACEHOLDER) {
                    literal.push(format!("{} step {index}", case.path));
                }
            }
        }
    }
    assert!(
        literal.is_empty(),
        "these cases pin a literal resumeToken instead of \"{PLACEHOLDER}\": {literal:#?}"
    );
}
