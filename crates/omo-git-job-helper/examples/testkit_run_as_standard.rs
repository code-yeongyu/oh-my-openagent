//! Testkit launcher (design section 14): `testkit_run_as_standard -- <exe> <args...>` runs the command under a
//! restricted copy of this process's token (max privileges dropped, Administrators deny-only, Medium integrity),
//! passes its own standard handles through, prints the child token facts on stderr and exits with the child's code.
#[cfg(windows)]
#[path = "../testkit/token.rs"]
mod token;
#[cfg(windows)]
#[path = "../testkit/win.rs"]
mod win;

#[cfg(windows)]
fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(("--", command)) = args.split_first().map(|(flag, rest)| (flag.as_str(), rest)) else {
        std::process::exit(2)
    };
    let Some((exe, rest)) = command.split_first() else {
        std::process::exit(2)
    };
    let restricted = match token::restricted_medium_token() {
        Ok(handle) => handle,
        Err(error) => {
            eprintln!("run-as-standard: token {error}");
            std::process::exit(3);
        }
    };
    let facts = token::facts(restricted.raw());
    eprintln!(
        "run-as-standard child-token elevated={} integrity=0x{:x}",
        facts.elevated, facts.integrity
    );
    let rest: Vec<&str> = rest.iter().map(String::as_str).collect();
    match token::run_as(&restricted, std::path::Path::new(exe), &rest) {
        Ok(code) => std::process::exit(i32::from_ne_bytes(code.to_ne_bytes())),
        Err(error) => {
            eprintln!("run-as-standard: CreateProcessAsUserW failed {error}");
            std::process::exit(3);
        }
    }
}

#[cfg(not(windows))]
fn main() {}
