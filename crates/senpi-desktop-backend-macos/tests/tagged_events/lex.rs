//! A small Rust lexer for the source guard: identifiers, string literals and
//! punctuation, with comments, char literals and lifetimes dropped, so a
//! guarded form is matched on code tokens only, whatever the line breaks.

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Tok {
    Ident(String),
    Str(String),
    Punct(char),
}

fn is_ident(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

pub fn tokens(source: &str) -> Vec<Tok> {
    let chars: Vec<char> = source.chars().collect();
    let at = |i: usize| chars.get(i).copied().unwrap_or('\0');
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c.is_whitespace() {
            i += 1;
        } else if c == '/' && at(i + 1) == '/' {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
        } else if c == '/' && at(i + 1) == '*' {
            i = block_comment_end(&chars, i);
        } else if let Some((text, end)) = raw_string(&chars, i) {
            out.push(Tok::Str(text));
            i = end;
        } else if c == '"' || (c == 'b' && at(i + 1) == '"') {
            let (text, end) = quoted(&chars, if c == 'b' { i + 1 } else { i });
            out.push(Tok::Str(text));
            i = end;
        } else if c == '\'' {
            i = after_quote(&chars, i);
        } else if is_ident(c) {
            let start = i;
            while i < chars.len() && is_ident(chars[i]) {
                i += 1;
            }
            out.push(Tok::Ident(chars[start..i].iter().collect()));
        } else {
            out.push(Tok::Punct(c));
            i += 1;
        }
    }
    out
}

fn block_comment_end(chars: &[char], start: usize) -> usize {
    let (mut depth, mut i) = (0usize, start);
    while i + 1 < chars.len() {
        match (chars[i], chars[i + 1]) {
            ('/', '*') => {
                depth += 1;
                i += 2;
            }
            ('*', '/') => {
                depth -= 1;
                i += 2;
                if depth == 0 {
                    return i;
                }
            }
            _ => i += 1,
        }
    }
    chars.len()
}

/// `r"..."`, `r#"..."#`, `br#"..."#` at `i`: its text and the index after it.
fn raw_string(chars: &[char], i: usize) -> Option<(String, usize)> {
    if i > 0 && is_ident(chars[i - 1]) {
        return None;
    }
    let mut j = i;
    if chars.get(j) == Some(&'b') {
        j += 1;
    }
    if chars.get(j) != Some(&'r') {
        return None;
    }
    j += 1;
    let hashes = chars[j..].iter().take_while(|c| **c == '#').count();
    j += hashes;
    if chars.get(j) != Some(&'"') {
        return None;
    }
    let body = j + 1;
    let mut k = body;
    while k < chars.len() {
        if chars[k] == '"'
            && chars[k + 1..]
                .iter()
                .take(hashes)
                .filter(|c| **c == '#')
                .count()
                == hashes
        {
            return Some((chars[body..k].iter().collect(), k + 1 + hashes));
        }
        k += 1;
    }
    Some((chars[body..].iter().collect(), chars.len()))
}

/// A `"..."` literal opening at `i`: its text and the index after it.
fn quoted(chars: &[char], i: usize) -> (String, usize) {
    let mut text = String::new();
    let mut k = i + 1;
    while k < chars.len() && chars[k] != '"' {
        if chars[k] == '\\' {
            k += 1;
        }
        if let Some(c) = chars.get(k) {
            text.push(*c);
        }
        k += 1;
    }
    (text, k + 1)
}

/// Skips a char literal (`'x'`, `'\n'`) or a lifetime (`'a`) opening at `i`.
fn after_quote(chars: &[char], i: usize) -> usize {
    if chars.get(i + 1) == Some(&'\\') {
        let mut k = i + 3;
        while k < chars.len() && chars[k] != '\'' {
            k += 1;
        }
        return k + 1;
    }
    if chars.get(i + 2) == Some(&'\'') {
        return i + 3;
    }
    let mut k = i + 1;
    while k < chars.len() && is_ident(chars[k]) {
        k += 1;
    }
    k
}
