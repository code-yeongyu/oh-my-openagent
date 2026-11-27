//! The `Exec` line's second layer: quoting, field codes, and the refusal of anything a shell
//! would interpret. The child is never started through a shell, so an entry that needs one is
//! refused instead of being run differently from what it says.

/// Why an `Exec` line is refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExecRefusal {
    /// An unquoted shell operator, a command substitution, or an unterminated quote.
    ShellOperator(char),
    /// The program is a shell asked to run a command string.
    ShellCommand(String),
    Empty,
}

const OPERATORS: &[char] = &[
    ';', '|', '&', '<', '>', '$', '`', '(', ')', '*', '?', '~', '#', '\'', '\n',
];
const SHELLS: &[&str] = &[
    "sh", "bash", "dash", "zsh", "ksh", "mksh", "fish", "csh", "tcsh", "busybox",
];

fn tokens(exec: &str) -> Result<Vec<(String, bool)>, ExecRefusal> {
    let mut out = Vec::new();
    let mut chars = exec.chars().peekable();
    while let Some(&c) = chars.peek() {
        if c == ' ' || c == '\t' {
            chars.next();
            continue;
        }
        let mut word = String::new();
        let quoted = c == '"';
        if quoted {
            chars.next();
            loop {
                match chars.next() {
                    Some('"') => break,
                    Some('\\') => match chars.next() {
                        Some(escaped @ ('"' | '`' | '$' | '\\')) => word.push(escaped),
                        _ => return Err(ExecRefusal::ShellOperator('\\')),
                    },
                    Some(inner @ ('`' | '$')) => return Err(ExecRefusal::ShellOperator(inner)),
                    Some(inner) => word.push(inner),
                    None => return Err(ExecRefusal::ShellOperator('"')),
                }
            }
        } else {
            while let Some(&next) = chars.peek() {
                if next == ' ' || next == '\t' {
                    break;
                }
                if OPERATORS.contains(&next) || next == '"' || next == '\\' {
                    return Err(ExecRefusal::ShellOperator(next));
                }
                word.push(next);
                chars.next();
            }
        }
        out.push((word, quoted));
    }
    Ok(out)
}

/// Expands the field codes of an unquoted word: `%%` is `%`, every file/URL/icon code is
/// dropped (nothing is opened with the app), and a word that was only a code disappears.
fn fields(word: &str) -> Option<String> {
    let mut out = String::new();
    let mut chars = word.chars();
    let mut code_only = true;
    while let Some(c) = chars.next() {
        if c == '%' {
            if chars.next() == Some('%') {
                out.push('%');
                code_only = false;
            }
            continue;
        }
        out.push(c);
        code_only = false;
    }
    (!code_only).then_some(out)
}

/// The argument vector an `Exec` value (already through the string-value unescape) runs as.
///
/// # Errors
/// An [`ExecRefusal`]: nothing is launched.
pub fn argv(exec: &str) -> Result<Vec<String>, ExecRefusal> {
    let mut argv = Vec::new();
    for (word, quoted) in tokens(exec)? {
        if quoted {
            argv.push(word);
        } else if let Some(expanded) = fields(&word) {
            argv.push(expanded);
        }
    }
    let program = argv.first().ok_or(ExecRefusal::Empty)?;
    let base = program.rsplit('/').next().unwrap_or(program);
    if SHELLS.contains(&base)
        && argv
            .iter()
            .skip(1)
            .any(|arg| arg.starts_with('-') && arg.contains('c'))
    {
        return Err(ExecRefusal::ShellCommand(base.to_owned()));
    }
    Ok(argv)
}
