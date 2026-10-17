//! Manual signed acceptance fixture. No production verification override.
#[cfg(target_os = "macos")]
#[path = "xpc_fixture/driver.rs"]
mod driver;

fn main() -> std::process::ExitCode {
    #[cfg(target_os = "macos")]
    match driver::run() {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("FIXTURE_FAILED {error}");
            std::process::ExitCode::FAILURE
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        eprintln!("signed XPC fixture requires macOS");
        std::process::ExitCode::FAILURE
    }
}
