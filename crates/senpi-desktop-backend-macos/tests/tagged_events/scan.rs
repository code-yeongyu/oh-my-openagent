//! Which forms create an untagged event, and which files of the crate are
//! production code: every file the module tree reaches from `lib.rs` other
//! than through a `#[cfg(test)]` module.

use std::path::{Path, PathBuf};

use crate::lex::{tokens, Tok};

fn ident(tok: Option<&Tok>) -> Option<&str> {
    match tok {
        Some(Tok::Ident(name)) => Some(name),
        _ => None,
    }
}

fn punct(tok: Option<&Tok>, c: char) -> bool {
    tok == Some(&Tok::Punct(c))
}

/// The guarded forms found in `tokens`: each names what bypasses the tagged
/// constructors in `input/cgevent.rs`.
pub fn bypasses(tokens: &[Tok]) -> Vec<&'static str> {
    let mut found = Vec::new();
    for (i, tok) in tokens.iter().enumerate() {
        let next = |k: usize| tokens.get(i + k);
        let Some(name) = ident(Some(tok)) else {
            continue;
        };
        if name.starts_with("CGEventCreate") {
            found.push("raw CGEventCreate* FFI");
        }
        if name != "CGEvent" {
            continue;
        }
        let path_call = |from: usize| {
            punct(next(from), ':')
                && punct(next(from + 1), ':')
                && ident(next(from + 2)).is_some_and(|f| f.starts_with("new"))
        };
        if path_call(1) || (punct(next(1), '>') && path_call(2)) {
            found.push("CGEvent::new*");
        }
        if ident(next(1)) == Some("as") {
            found.push("CGEvent imported under another name");
        }
        if punct(next(1), ';') && is_type_alias(&tokens[..i]) {
            found.push("type alias of CGEvent");
        }
    }
    found
}

/// Whether the statement ending at the end of `before` is `type X = ...`.
fn is_type_alias(before: &[Tok]) -> bool {
    let start = before
        .iter()
        .rposition(|tok| matches!(tok, Tok::Punct(';' | '{' | '}')))
        .map_or(0, |at| at + 1);
    let statement = &before[start..];
    statement.contains(&Tok::Ident("type".into())) && statement.contains(&Tok::Punct('='))
}

/// The attributes before item `at`, as their token runs, skipping a
/// visibility (`pub`, `pub(crate)`, `pub(in path)`).
fn attributes(tokens: &[Tok], at: usize) -> Vec<&[Tok]> {
    let mut end = at;
    while end > 0
        && matches!(&tokens[end - 1], Tok::Ident(v) if v == "pub" || v == "crate" || v == "super" || v == "self" || v == "in")
        || end > 0 && matches!(&tokens[end - 1], Tok::Punct('(' | ')'))
    {
        end -= 1;
    }
    let mut found = Vec::new();
    while end > 0 && punct(tokens.get(end - 1), ']') {
        let Some(open) = tokens[..end]
            .iter()
            .rposition(|tok| *tok == Tok::Punct('#'))
        else {
            break;
        };
        found.push(&tokens[open + 2..end - 1]);
        end = open;
    }
    found
}

fn is_cfg_test(attribute: &[Tok]) -> bool {
    ident(attribute.first()) == Some("cfg")
        && attribute.contains(&Tok::Ident("test".into()))
        && !attribute.contains(&Tok::Ident("not".into()))
}

fn path_attribute(attribute: &[Tok]) -> Option<&str> {
    match attribute {
        [Tok::Ident(path), Tok::Punct('='), Tok::Str(value)] if path == "path" => Some(value),
        _ => None,
    }
}

/// One file of the module tree.
pub struct Module {
    pub path: PathBuf,
    pub test: bool,
    /// The file's tokens outside inline `#[cfg(test)] mod x { ... }` bodies.
    pub production_tokens: Vec<Tok>,
}

/// Walks the module tree from `root` (`src/lib.rs`), reading files through
/// `read` so tests can hand it a virtual tree.
pub fn module_tree(root: &Path, read: &dyn Fn(&Path) -> Option<String>) -> Vec<Module> {
    let mut modules = Vec::new();
    let mut pending = vec![(root.to_path_buf(), false)];
    while let Some((path, test)) = pending.pop() {
        let Some(source) = read(&path) else { continue };
        let toks = tokens(&source);
        let here = path.parent().unwrap_or(Path::new("")).to_path_buf();
        let stem = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or_default();
        let children_dir = if matches!(stem, "lib" | "mod" | "main") {
            here.clone()
        } else {
            here.join(stem)
        };
        let mut production_tokens = Vec::new();
        let mut i = 0;
        while i < toks.len() {
            if ident(toks.get(i)) == Some("mod") {
                if let Some(name) = ident(toks.get(i + 1)) {
                    let attrs = attributes(&toks, i);
                    let child_test = test || attrs.iter().any(|attribute| is_cfg_test(attribute));
                    if punct(toks.get(i + 2), ';') {
                        let child = match attrs
                            .iter()
                            .find_map(|attribute| path_attribute(attribute))
                        {
                            Some(relative) => here.join(relative),
                            None if read(&children_dir.join(format!("{name}.rs"))).is_some() => {
                                children_dir.join(format!("{name}.rs"))
                            }
                            None => children_dir.join(name).join("mod.rs"),
                        };
                        pending.push((child, child_test));
                    } else if punct(toks.get(i + 2), '{') && child_test && !test {
                        i = matching_brace(&toks, i + 2) + 1;
                        continue;
                    }
                }
            }
            production_tokens.push(toks[i].clone());
            i += 1;
        }
        modules.push(Module {
            path,
            test,
            production_tokens,
        });
    }
    modules
}

fn matching_brace(tokens: &[Tok], open: usize) -> usize {
    let mut depth = 0usize;
    for (k, tok) in tokens.iter().enumerate().skip(open) {
        match tok {
            Tok::Punct('{') => depth += 1,
            Tok::Punct('}') => {
                depth -= 1;
                if depth == 0 {
                    return k;
                }
            }
            _ => {}
        }
    }
    tokens.len()
}
