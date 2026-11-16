//! `--presence-helper`: the detached presence renderer's entry point over the helper's standard
//! streams (row 28; the Windows named-pipe channel and job containment arrive with row 57). It
//! exits within 2 s of its parent's death. Death is read from the parent pid, never from stdin
//! alone: a shell hands a background job `/dev/null` as stdin, so EOF says nothing about the
//! parent, and a SIGKILLed parent sends no signal to anyone.

use std::io::BufRead;
use std::process::ExitCode;

use super::parent::ParentWatch;

/// A line the renderer understands; anything else is ignored, never an error.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Command {
    Show(String),
    Hide,
}

fn command(line: &str) -> Option<Command> {
    match line.trim().split_once(' ') {
        Some(("show", label)) => Some(Command::Show(label.to_owned())),
        None if line.trim() == "hide" => Some(Command::Hide),
        _ => None,
    }
}

pub fn run() -> ExitCode {
    let watch = ParentWatch::new();
    std::thread::spawn(|| {
        for line in std::io::stdin().lock().lines().map_while(Result::ok) {
            if let Some(command) = command(&line) {
                eprintln!("omo-computer-engine presence: {command:?}");
            }
        }
    });
    watch.wait_for_death();
    ExitCode::SUCCESS
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn show_and_hide_are_read_and_noise_is_ignored() {
        assert_eq!(command("show agent typing"), Some(Command::Show("agent typing".to_owned())));
        assert_eq!(command("hide\n"), Some(Command::Hide));
        assert_eq!(command("explode"), None);
    }
}
