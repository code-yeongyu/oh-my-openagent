//! Read-only TCC identity probe; stdin keeps it alive for an independent API check.

#[cfg(target_os = "macos")]
#[path = "../src/responsible.rs"]
mod responsible;

#[cfg(target_os = "macos")]
fn main() -> std::io::Result<()> {
    use std::io::Write;

    println!("pid={}", std::process::id());
    println!("(TCC identity: {})", responsible::suffix_with(responsible::current));
    std::io::stdout().flush()?;
    let mut line = String::new();
    std::io::stdin().read_line(&mut line)?;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn main() {}
