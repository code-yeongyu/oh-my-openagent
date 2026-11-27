//! One `.desktop` file's `[Desktop Entry]` group, as far as listing and launching need it.

use std::path::{Path, PathBuf};

/// A launchable application entry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DesktopEntry {
    /// The desktop id: the file name without `.desktop`.
    pub id: String,
    pub name: String,
    pub exec: String,
    pub path: PathBuf,
}

/// The string-value escapes of the Desktop Entry spec (`\s`, `\n`, `\t`, `\r`, `\\`): the
/// first of the two layers an `Exec` value goes through.
#[must_use]
pub fn unescape_value(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('s') => out.push(' '),
            Some('n') => out.push('\n'),
            Some('t') => out.push('\t'),
            Some('r') => out.push('\r'),
            Some(other) => {
                out.push('\\');
                out.push(other);
            }
            None => out.push('\\'),
        }
    }
    out
}

impl DesktopEntry {
    /// `None` for anything but a visible `Type=Application` entry with a name and an `Exec`.
    #[must_use]
    pub fn parse(path: &Path, contents: &str) -> Option<Self> {
        let id = path
            .file_name()?
            .to_str()?
            .strip_suffix(".desktop")?
            .to_owned();
        let (mut in_group, mut kind, mut name, mut exec, mut hidden) =
            (false, None, None, None, false);
        for line in contents.lines().map(str::trim) {
            if line.starts_with('[') {
                in_group = line == "[Desktop Entry]";
                continue;
            }
            let Some((key, value)) = line
                .split_once('=')
                .filter(|_| in_group && !line.starts_with('#'))
            else {
                continue;
            };
            match key.trim() {
                "Type" => kind = Some(value.trim().to_owned()),
                "Name" => name = Some(unescape_value(value.trim())),
                "Exec" => exec = Some(unescape_value(value.trim())),
                "Hidden" => hidden = value.trim() == "true",
                _ => {}
            }
        }
        if hidden || kind.as_deref() != Some("Application") {
            return None;
        }
        Some(Self {
            id,
            name: name?,
            exec: exec?,
            path: path.to_path_buf(),
        })
    }
}
