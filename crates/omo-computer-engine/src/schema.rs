//! `--schema`: prints the protocol schema the core generates, byte-equal to the committed file.

use std::io::{self, Write};
use std::process::ExitCode;

use omo_computer_core::schema::engine_schema_text;

pub fn run() -> ExitCode {
    match io::stdout().lock().write_all(engine_schema_text().as_bytes()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("omo-computer-engine: --schema: {error}");
            ExitCode::FAILURE
        }
    }
}
