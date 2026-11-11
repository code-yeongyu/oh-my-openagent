//! The omo-computer-engine binary: router, entry modes, exposure bridge, MCP shim, daemon and launcher.

/// Prints the engine version for `--version`; every other mode arrives with the rows that build it.
fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|arg| arg == "--version") {
        println!("omo-computer-engine {}", env!("CARGO_PKG_VERSION"));
        return;
    }
    eprintln!("usage: omo-computer-engine --version");
    std::process::exit(2);
}
