//! Testkit image for N2(b): <threads> threads call `CreateProcessW(<child> <suffix>)` in a loop (no breakaway flag)
//! until <max> creations, then the process parks; it never exits on its own.
#[cfg(windows)]
#[path = "../testkit/win.rs"]
mod win;

#[cfg(windows)]
fn main() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    let args: Vec<String> = std::env::args().collect();
    let [_, child, suffix, threads, max] = args.as_slice() else {
        std::process::exit(2)
    };
    let (Ok(threads), Ok(max)) = (threads.parse::<usize>(), max.parse::<usize>()) else {
        std::process::exit(2)
    };
    let created = Arc::new(AtomicUsize::new(0));
    for _ in 0..threads {
        let (created, child, suffix) = (
            Arc::clone(&created),
            std::path::PathBuf::from(child),
            suffix.clone(),
        );
        std::thread::spawn(move || {
            while created.fetch_add(1, Ordering::SeqCst) < max {
                if let Ok((process, _)) = win::spawn(&child, &[&suffix], 0) {
                    drop(process);
                }
            }
        });
    }
    loop {
        std::thread::park();
    }
}

#[cfg(not(windows))]
fn main() {}
