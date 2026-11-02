#![cfg(target_os = "macos")]

use std::process::Command;

fn run(mode: &str) -> std::process::Output {
    let dir = tempfile::tempdir().expect("fixture directory");
    let host = dir.path().join("launch-context-host");
    let compiled = Command::new("clang")
        .args(["-Wall", "-Wextra", "-Werror"])
        .arg(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/launch-context.c"
        ))
        .arg("-o")
        .arg(&host)
        .output()
        .expect("compile process fixture");
    assert!(
        compiled.status.success(),
        "{}",
        String::from_utf8_lossy(&compiled.stderr)
    );
    Command::new(&host)
        .arg(mode)
        .arg(env!("CARGO_BIN_EXE_senpi-desktop-engine"))
        .env(
            "SENPI_DESKTOP_BACKEND",
            concat!(
                "fake:",
                env!("CARGO_MANIFEST_DIR"),
                "/../senpi-desktop-backend-fake/fixtures/two-displays-one-window.json"
            ),
        )
        .output()
        .expect("process fixture")
}

#[test]
fn a_self_responsible_host_can_start_an_engine_responsible_to_that_host() {
    let result = run("valid");
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
}

#[test]
fn launcher_exit_before_spawn_still_runs_the_actual_child_gate() {
    let result = run("loss");
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let stderr = String::from_utf8_lossy(&result.stderr);
    let line = stderr
        .lines()
        .find(|line| line.starts_with("SENPI_DESKTOP_LAUNCH_REFUSED "))
        .expect("actual child's refusal after event-confirmed launcher exit");
    assert!(line.len() < 512);
    let value: serde_json::Value = serde_json::from_str(
        line.strip_prefix("SENPI_DESKTOP_LAUNCH_REFUSED ")
            .expect("prefix"),
    )
    .expect("refusal JSON");
    assert_eq!(value["version"], 1);
    assert!(matches!(
        value["reason"].as_str(),
        Some("self-responsible" | "unresolved")
    ));
}
