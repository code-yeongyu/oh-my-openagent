//! Local signed-fixture probe. Never verifies a caller-supplied token or PID.
#[cfg(target_os = "macos")]
#[path = "verify_self/status.rs"]
mod status;

#[cfg(target_os = "macos")]
fn main() -> std::process::ExitCode {
    use senpi_desktop_xpc::identity::{AuditToken, SecurityVerifier};

    let role = match std::env::args().nth(1).as_deref() {
        Some("engine") => true,
        Some("controller") => false,
        _ => {
            eprintln!("usage: verify_self <engine|controller>");
            return std::process::ExitCode::from(2);
        }
    };
    // Independent diagnostic output; never fed into the verifier or its policy.
    match status::current() {
        Ok(bits) => println!(
            "dynamic_status=0x{bits:08x} valid={} runtime={} hard={} kill={} debugged={}",
            bits & 1 != 0,
            bits & 0x10000 != 0,
            bits & 0x100 != 0,
            bits & 0x200 != 0,
            bits & 0x10000000 != 0,
        ),
        Err(error) => println!("dynamic_status_error={error}"),
    }
    let verdict = AuditToken::current().and_then(|token| {
        let verifier = SecurityVerifier::from_audit_token(token);
        if role {
            verifier.verify_server()
        } else {
            verifier.verify_privileged_client()
        }
    });
    println!("verdict={verdict:?}");
    std::process::ExitCode::SUCCESS
}

#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("verify_self requires macOS");
    std::process::exit(2);
}
