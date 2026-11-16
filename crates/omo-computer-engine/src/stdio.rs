//! `--stdio`: one JSON-RPC message per line in, one reply line out, until stdin closes. Lines
//! are read as raw bytes, so a line that is not UTF-8 answers -32700 and the loop goes on.
//! While the session holds input, the wait for the next line is bounded by the nearest hold
//! deadline, and a wait that runs out releases what reached the bound (row 23, R49). Closing
//! stdin closes the session, which releases every hold.

use std::io::{self, BufRead, Write};
use std::process::ExitCode;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::time::Duration;

use omo_computer_core::paths;
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
    let lookup = |name: &str| vars.iter().find(|(key, _)| key == name).map(|(_, value)| value.clone());
    let roots = match paths::resolve(lookup) {
        Ok(roots) => roots,
        Err(error) => {
            eprintln!("omo-computer-engine: state directory unavailable: {error}");
            return ExitCode::from(2);
        }
    };
    let (lines, incoming) = mpsc::channel();
    std::thread::spawn(move || {
        for line in io::stdin().lock().split(b'\n') {
            if lines.send(line).is_err() {
                break;
            }
        }
    });
    match serve(&mut Session::for_roots(backend, &roots), incoming, &mut io::stdout().lock()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("omo-computer-engine: stdio: {error}");
            ExitCode::FAILURE
        }
    }
}

/// The next input line, waited for at most `wait`.
pub enum Next {
    Line(io::Result<Vec<u8>>),
    TimedOut,
    Closed,
}

/// Where the serve loop reads its lines from.
pub trait Incoming {
    fn next(&mut self, wait: Option<Duration>) -> Next;
}

/// A plain reader blocks; it has no deadline to honour (tests and pipes read to the end).
impl<R: BufRead> Incoming for io::Split<R> {
    fn next(&mut self, _wait: Option<Duration>) -> Next {
        Iterator::next(self).map_or(Next::Closed, Next::Line)
    }
}

impl Incoming for Receiver<io::Result<Vec<u8>>> {
    fn next(&mut self, wait: Option<Duration>) -> Next {
        match wait {
            None => self.recv().map_or(Next::Closed, Next::Line),
            Some(wait) => match self.recv_timeout(wait) {
                Ok(line) => Next::Line(line),
                Err(RecvTimeoutError::Timeout) => Next::TimedOut,
                Err(RecvTimeoutError::Disconnected) => Next::Closed,
            },
        }
    }
}

/// # Errors
/// Reading the input or writing a reply failed.
pub fn serve(session: &mut Session, mut input: impl Incoming, output: &mut impl Write) -> io::Result<()> {
    loop {
        match input.next(session.hold_wait()) {
            Next::Closed => break,
            Next::TimedOut => session.release_due_holds(),
            Next::Line(line) => {
                let line = line?;
                if line.trim_ascii().is_empty() {
                    continue;
                }
                if let Some(reply) = rpc::handle_line(session, &line) {
                    writeln!(output, "{reply}")?;
                    output.flush()?;
                }
            }
        }
    }
    session.close();
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
        serve(&mut session, BufRead::split(input.as_slice(), b'\n'), &mut output).expect("the loop survives the bad line");
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
