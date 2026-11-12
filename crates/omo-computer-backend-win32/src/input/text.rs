//! Typed text on the two layout-independent routes (d-windows.md '## Input', Typing): under a
//! foreground lease one `KEYEVENTF_UNICODE` down/up pair per UTF-16 unit, both halves of a
//! surrogate pair in one batch, a newline as scan-coded Return; in the background one `WM_CHAR`
//! per UTF-16 unit and each `\r`, `\n` or `\r\n` as one Return press.

use super::{posted_key, KeyUnit, Posted, VK_RETURN, WM_CHAR};

/// One newline-free run or one newline, so `\r\n` counts once.
fn pieces(text: &str) -> Vec<Option<char>> {
    let mut out = Vec::new();
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\r' => {
                if chars.peek() == Some(&'\n') {
                    chars.next();
                }
                out.push(None);
            }
            '\n' => out.push(None),
            other => out.push(Some(other)),
        }
    }
    out
}

/// The `SendInput` batches of `text`, one per code point.
#[must_use]
pub fn foreground_batches(text: &str) -> Vec<Vec<KeyUnit>> {
    pieces(text)
        .into_iter()
        .map(|piece| match piece {
            None => vec![
                KeyUnit::scan_coded(VK_RETURN, true),
                KeyUnit::scan_coded(VK_RETURN, false),
            ],
            Some(c) => {
                let mut units = [0u16; 2];
                c.encode_utf16(&mut units)
                    .iter()
                    .flat_map(|unit| {
                        [
                            KeyUnit::unicode(*unit, true),
                            KeyUnit::unicode(*unit, false),
                        ]
                    })
                    .collect()
            }
        })
        .collect()
}

/// The posted messages of `text`, one `WM_CHAR` per UTF-16 unit.
#[must_use]
pub fn background_chars(text: &str) -> Vec<Posted> {
    let mut out = Vec::new();
    for piece in pieces(text) {
        match piece {
            None => {
                out.push(posted_key(VK_RETURN, true, false));
                out.push(posted_key(VK_RETURN, false, false));
            }
            Some(c) => {
                let mut units = [0u16; 2];
                for unit in c.encode_utf16(&mut units).iter() {
                    out.push(Posted {
                        msg: WM_CHAR,
                        wparam: usize::from(*unit),
                        lparam: 1,
                    });
                }
            }
        }
    }
    out
}
