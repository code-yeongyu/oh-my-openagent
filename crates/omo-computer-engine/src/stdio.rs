//! `--stdio`: one JSON-RPC message per line in, one reply line out, until stdin closes. Lines
//! are read as raw bytes, so a line that is not UTF-8 answers -32700 and the loop goes on.

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
    for line in input.split(b'\n') {
        let line = line?;
        if line.trim_ascii().is_empty() {
            continue;
        }
        if let Some(reply) = rpc::handle_line(session, &line) {
            writeln!(output, "{reply}")?;
            output.flush()?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use omo_computer_backend_fake::FakeBackend;
    use serde_json::Value;

    use super::*;

    #[test]
    fn a_non_utf8_line_answers_a_parse_error_and_the_loop_goes_on() {
        let backend = FakeBackend::from_json("{}").expect("empty scenario");
        let mut session = Session::new(Box::new(backend));
        let mut input = vec![0xff, 0xfe, b'\n'];
        input.extend_from_slice(br#"{"jsonrpc":"2.0","id":2,"method":"capabilities","params":{}}"#);
        input.push(b'\n');
        let mut output = Vec::new();
        serve(&mut session, input.as_slice(), &mut output).expect("the loop survives the bad line");
        let replies: Vec<Value> = String::from_utf8(output)
            .expect("replies are UTF-8")
            .lines()
            .map(|line| serde_json::from_str(line).expect("each reply is JSON"))
            .collect();
        assert_eq!(replies.len(), 2, "{replies:?}");
        assert_eq!(replies[0]["error"]["code"], rpc::PARSE_ERROR);
        assert_eq!((replies[1]["id"].clone(), replies[1]["result"]["backend"].clone()), (2.into(), "fake".into()));
    }
}
