//! Testkit image: connects to `\\.\pipe\<suffix>`, announces `ready <pid>`, then blocks until the pipe closes.
#[cfg(windows)]
#[path = "../testkit/win.rs"]
mod win;

#[cfg(windows)]
fn main() {
    let Some(suffix) = std::env::args().nth(1) else {
        std::process::exit(2)
    };
    let pipe = win::connect_forever(&suffix);
    let announced = win::write_all(
        pipe.raw(),
        format!("ready {}\n", std::process::id()).as_bytes(),
    );
    if announced {
        win::read_until_eof(pipe.raw());
    }
}

#[cfg(not(windows))]
fn main() {}
