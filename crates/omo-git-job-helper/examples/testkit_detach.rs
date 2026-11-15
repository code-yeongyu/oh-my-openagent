//! Testkit image: starts <blocker> <suffix> and exits at once, leaving the blocker as a lingering job member.
#[cfg(windows)]
#[path = "../testkit/win.rs"]
mod win;

#[cfg(windows)]
fn main() {
    let args: Vec<String> = std::env::args().collect();
    let [_, blocker, suffix] = args.as_slice() else {
        std::process::exit(2)
    };
    match win::spawn(std::path::Path::new(blocker), &[suffix], 0) {
        Ok((_, pid)) => println!("detached {pid}"),
        Err(error) => std::process::exit(i32::try_from(error).unwrap_or(1)),
    }
}

#[cfg(not(windows))]
fn main() {}
