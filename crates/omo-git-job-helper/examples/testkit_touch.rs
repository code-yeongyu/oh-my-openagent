//! Testkit image: writes the sentinel file named by its only argument.
fn main() {
    let Some(path) = std::env::args().nth(1) else {
        std::process::exit(2)
    };
    if std::fs::write(path, b"touched").is_err() {
        std::process::exit(1);
    }
}
