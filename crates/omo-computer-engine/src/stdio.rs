//! `--stdio`: one JSON-RPC message per line in, one reply line out, until stdin closes.

use std::io::{self, BufRead, Write};
use std::process::ExitCode;

use omo_computer_session::Session;

use crate::{route, rpc};

pub fn run() -> ExitCode {
    let vars: Vec<(String, String)> = std::env::vars().collect();
    let backend = match route::backend(&vars) {
        Ok(backend) => backend,
        Err(error) => {
            eprintln!("omo-computer-engine: {error}");
            return ExitCode::from(2);
        }
    };
    match serve(&mut Session::new(backend), io::stdin().lock(), &mut io::stdout().lock()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("omo-computer-engine: stdio: {error}");
            ExitCode::FAILURE
        }
    }
}

/// # Errors
/// Reading the input or writing a reply failed.
pub fn serve(session: &mut Session, input: impl BufRead, output: &mut impl Write) -> io::Result<()> {
    for line in input.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        if let Some(reply) = rpc::handle_line(session, &line) {
            writeln!(output, "{reply}")?;
            output.flush()?;
        }
    }
    Ok(())
}
