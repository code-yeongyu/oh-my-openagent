//! Control-pipe frames from the writer (design v4.2 section 6.1): newline-terminated ASCII, except `exec`, whose
//! three fields (cwd, absolute exe, command line) are length-prefixed UTF-8 (`<len>:<bytes>`) so a command line
//! may carry any byte, newlines included. Portable and unit-tested on every host.

const EXEC: &[u8] = b"exec ";
const MAX_PENDING: usize = 1 << 20;

#[derive(Debug, PartialEq, Eq)]
pub struct ExecRequest {
    pub cwd: String,
    pub exe: String,
    pub command_line: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Frame {
    Exec(ExecRequest),
    Go,
    Cancel,
    TerminateRoot,
    /// Anything else, a bad length prefix or an oversized frame. Before `go` it means cancel; after, it is ignored.
    Malformed,
}

#[derive(Default)]
pub struct FrameReader {
    pending: Vec<u8>,
}

enum Field<'a> {
    Incomplete,
    Bad,
    Done(&'a [u8], usize),
}

fn field(bytes: &[u8]) -> Field<'_> {
    let Some(colon) = bytes.iter().position(|&byte| byte == b':') else {
        return if bytes.len() > 10 || !bytes.iter().all(u8::is_ascii_digit) {
            Field::Bad
        } else {
            Field::Incomplete
        };
    };
    let digits = &bytes[..colon];
    let length = std::str::from_utf8(digits)
        .ok()
        .filter(|text| !text.is_empty() && text.len() <= 10)
        .and_then(|text| text.parse::<usize>().ok());
    let Some(length) = length.filter(|&length| length <= MAX_PENDING) else {
        return Field::Bad;
    };
    match bytes.get(colon + 1..colon + 1 + length) {
        Some(value) => Field::Done(value, colon + 1 + length),
        None => Field::Incomplete,
    }
}

fn utf8(bytes: &[u8]) -> Option<String> {
    String::from_utf8(bytes.to_vec()).ok()
}

impl FrameReader {
    pub fn push(&mut self, bytes: &[u8]) {
        self.pending.extend_from_slice(bytes);
    }

    /// The next complete frame, or `None` until more bytes arrive.
    pub fn next_frame(&mut self) -> Option<Frame> {
        if self.pending.starts_with(EXEC) {
            return self.next_exec();
        }
        if EXEC.starts_with(&self.pending) && !self.pending.contains(&b'\n') {
            return None;
        }
        let Some(end) = self.pending.iter().position(|&byte| byte == b'\n') else {
            return (self.pending.len() > MAX_PENDING).then(|| self.reset());
        };
        let line: Vec<u8> = self.pending.drain(..=end).collect();
        Some(match &line[..end] {
            b"go" => Frame::Go,
            b"cancel" => Frame::Cancel,
            b"terminate-root" => Frame::TerminateRoot,
            _ => Frame::Malformed,
        })
    }

    fn next_exec(&mut self) -> Option<Frame> {
        let mut offset = EXEC.len();
        let mut values = Vec::with_capacity(3);
        for _ in 0..3 {
            match field(&self.pending[offset..]) {
                Field::Incomplete => {
                    return (self.pending.len() > MAX_PENDING).then(|| self.reset())
                }
                Field::Bad => return Some(self.reset()),
                Field::Done(value, used) => {
                    values.push(value.to_vec());
                    offset += used;
                }
            }
        }
        match self.pending.get(offset) {
            None => return None,
            Some(b'\n') => {}
            Some(_) => return Some(self.reset()),
        }
        self.pending.drain(..=offset);
        let [cwd, exe, command_line] = values.as_slice() else {
            return Some(Frame::Malformed);
        };
        let request = (utf8(cwd), utf8(exe), utf8(command_line));
        Some(match request {
            (Some(cwd), Some(exe), Some(command_line)) if !exe.is_empty() => {
                Frame::Exec(ExecRequest {
                    cwd,
                    exe,
                    command_line,
                })
            }
            _ => Frame::Malformed,
        })
    }

    /// A malformed stream cannot be resynchronised: everything buffered is dropped.
    fn reset(&mut self) -> Frame {
        self.pending.clear();
        Frame::Malformed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frames(chunks: &[&[u8]]) -> Vec<Frame> {
        let mut reader = FrameReader::default();
        let mut out = Vec::new();
        for chunk in chunks {
            reader.push(chunk);
            while let Some(frame) = reader.next_frame() {
                out.push(frame);
            }
        }
        out
    }

    #[test]
    fn line_frames_and_an_exec_split_across_reads() {
        let exec = Frame::Exec(ExecRequest {
            cwd: "C:\\r".into(),
            exe: "C:\\g.exe".into(),
            command_line: "g -m \"a\nb\"".into(),
        });
        let got = frames(&[
            b"ex",
            b"ec 4:C:\\r8:C:\\g.exe1",
            b"0:g -m \"a\nb\"\ngo\n",
            b"terminate-root\ncancel\n",
        ]);
        assert_eq!(
            got,
            vec![exec, Frame::Go, Frame::TerminateRoot, Frame::Cancel]
        );
    }

    #[test]
    fn unknown_lines_and_bad_exec_fields_are_malformed() {
        assert_eq!(frames(&[b"bogus\n"]), vec![Frame::Malformed]);
        assert_eq!(frames(&[b"exec x:1\n"]), vec![Frame::Malformed]);
        assert_eq!(
            frames(&[b"exec 0:0:0:\n"]),
            vec![Frame::Malformed],
            "an empty exe is refused"
        );
        assert_eq!(
            frames(&[b"exec 1:a1:b1:cX"]),
            vec![Frame::Malformed],
            "fields must end with a newline"
        );
        assert_eq!(
            frames(&[b"exec 1:a1:b2:\xff\xfe\n"]),
            vec![Frame::Malformed],
            "fields are UTF-8"
        );
    }

    #[test]
    fn a_frame_waits_for_its_last_byte() {
        let mut reader = FrameReader::default();
        reader.push(b"exec 1:a1:b1:c");
        assert_eq!(reader.next_frame(), None);
        reader.push(b"\n");
        assert!(matches!(reader.next_frame(), Some(Frame::Exec(_))));
        reader.push(b"g");
        assert_eq!(reader.next_frame(), None);
    }
}
