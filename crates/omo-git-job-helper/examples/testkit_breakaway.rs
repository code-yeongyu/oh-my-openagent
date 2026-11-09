//! Testkit image for N5: tries `CreateProcessW(<child> <sentinel>, CREATE_BREAKAWAY_FROM_JOB)` and prints the outcome.
#[cfg(windows)]
#[path = "../testkit/win.rs"]
mod win;

#[cfg(windows)]
fn main() {
    use windows_sys::Win32::System::Threading::CREATE_BREAKAWAY_FROM_JOB;

    let args: Vec<String> = std::env::args().collect();
    let [_, child, sentinel] = args.as_slice() else {
        std::process::exit(2)
    };
    match win::spawn(
        std::path::Path::new(child),
        &[sentinel],
        CREATE_BREAKAWAY_FROM_JOB,
    ) {
        Ok((_, pid)) => println!("breakaway ok=1 pid={pid}"),
        Err(error) => println!("breakaway ok=0 err={error}"),
    }
}

#[cfg(not(windows))]
fn main() {}
