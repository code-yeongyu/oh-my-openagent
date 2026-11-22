//! A-IS-65 L3: `--selftest` prints where this engine takes the interaction lock, from the one
//! RUNTIME-root resolver, in its text and JSON output.

use std::path::Path;
use std::process::Command;

use serde_json::Value;

const ENGINE: &str = env!("CARGO_BIN_EXE_omo-computer-engine");

fn selftest(runtime: &Path, args: &[&str]) -> String {
    let output = Command::new(ENGINE)
        .args(args)
        .env("OMO_COMPUTER_RUNTIME_DIR", runtime)
        .output()
        .expect("the engine runs");
    assert!(output.status.success(), "{output:?}");
    String::from_utf8(output.stdout).expect("UTF-8 output")
}

#[test]
fn selftest_prints_the_interaction_lock_path_from_the_runtime_root() {
    let runtime = tempfile::tempdir().expect("tempdir");
    let expected = runtime.path().join("interaction.lock");
    let text = selftest(runtime.path(), &["--selftest"]);
    assert!(
        text.lines()
            .any(|line| line == format!("interaction lock: {}", expected.display())),
        "{text}"
    );
    let json: Value =
        serde_json::from_str(selftest(runtime.path(), &["--selftest", "--json"]).trim())
            .expect("one JSON line");
    assert_eq!(
        json["interactionLock"],
        expected.display().to_string(),
        "{json}"
    );
}
