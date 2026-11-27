use std::process::Command;

#[test]
fn xpc_mode_cannot_be_combined_with_legacy_modes() {
    // given
    for flag in [
        "--stdio",
        "--serve",
        "--oneshot",
        "--mcp",
        "--selftest",
        "--schema",
    ] {
        let mut command = Command::new(env!("CARGO_BIN_EXE_senpi-desktop-engine"));
        command.args(["--xpc-agent", "test.invalid", flag]);
        if flag == "--serve" {
            command.arg("test.socket");
        }
        // when
        let output = command.output().unwrap();
        // then
        assert!(!output.status.success());
        let error = String::from_utf8(output.stderr).unwrap();
        assert!(error.contains("cannot be used with"), "{error}");
    }
}
