//! The engine-to-helper stream: what an input request presses, how each press
//! is released, drag moves and releases, as length-checked binary records.
//! Ported from oh-my-pi `desktop/macos/release.rs` (MIT). The engine's
//! integration tests compile this file on its own, so it uses only `std`.

/// The record format; a helper refuses a stream of another version.
pub(crate) const VERSION: u8 = 1;
/// Bytes of the per-spawn token the engine puts on the helper's argv and
/// repeats in the stream's first record.
pub(crate) const TOKEN_LEN: usize = 16;
/// Sent by the helper once it follows the user's own keys and buttons (after
/// [`Record::Observe`]), so no press on the shared HID route races that start.
pub(crate) const READY: u8 = 1;
/// The longest character a typed key carries, in bytes.
const MAX_TEXT: usize = 64;

/// How an event reached its target.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Route {
    /// `CGEventPost(kCGHIDEventTap)`, shared with the user's own devices.
    Hid,
    /// The authenticated SkyLight keyboard route of one process.
    Keyboard(i32),
    /// The stamped SkyLight pointer route of one window, at a window-local
    /// point where the release lands.
    Window { pid: i32, wid: u32, x: f64, y: f64 },
}

/// A route without the point a pointer release lands on: two presses of the
/// same input on one lane are the same hold.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Lane {
    Hid,
    Keyboard(i32),
    Window(i32, u32),
}

impl Route {
    pub(crate) const fn lane(self) -> Lane {
        match self {
            Self::Hid => Lane::Hid,
            Self::Keyboard(pid) => Lane::Keyboard(pid),
            Self::Window { pid, wid, .. } => Lane::Window(pid, wid),
        }
    }
}

/// What a press holds down: a virtual key code or a mouse button number.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Input {
    Key(u16),
    Button(u8),
}

/// One record of the stream.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Record {
    /// The first record: the format version and the token of the helper's
    /// argv, proving the writer is the process that spawned it.
    Hello { version: u8, token: [u8; TOKEN_LEN] },
    /// Presses will go to the shared HID route: start following what the
    /// user physically holds, then answer [`READY`].
    Observe,
    /// `input` went down on `route`; a typed key carries its character.
    Press { id: u32, route: Route, input: Input, text: Option<String> },
    /// The release of press `id` moved, as a drag does.
    Update { id: u32, route: Route },
    /// Press `id` was released.
    Release { id: u32 },
}

const HELLO: u8 = b'H';
const OBSERVE: u8 = b'O';
const PRESS: u8 = b'P';
const UPDATE: u8 = b'U';
const RELEASE: u8 = b'R';

impl Record {
    pub(crate) fn encode(&self, out: &mut Vec<u8>) {
        match self {
            Self::Hello { version, token } => {
                out.push(HELLO);
                out.push(*version);
                out.extend_from_slice(token);
            }
            Self::Observe => out.push(OBSERVE),
            Self::Press { id, route, input, text } => {
                out.push(PRESS);
                out.extend_from_slice(&id.to_le_bytes());
                put_route(out, *route);
                let (kind, code) = match *input {
                    Input::Key(code) => (0u8, code),
                    Input::Button(number) => (1, u16::from(number)),
                };
                out.push(kind);
                out.extend_from_slice(&code.to_le_bytes());
                match text {
                    Some(text) => {
                        out.push(1);
                        out.extend_from_slice(&u32::try_from(text.len()).unwrap_or(u32::MAX).to_le_bytes());
                        out.extend_from_slice(text.as_bytes());
                    }
                    None => out.push(0),
                }
            }
            Self::Update { id, route } => {
                out.push(UPDATE);
                out.extend_from_slice(&id.to_le_bytes());
                put_route(out, *route);
            }
            Self::Release { id } => {
                out.push(RELEASE);
                out.extend_from_slice(&id.to_le_bytes());
            }
        }
    }

    /// The first complete record in `bytes` and its encoded length; `None`
    /// while it is incomplete. A malformed stream is an error.
    pub(crate) fn decode(bytes: &[u8]) -> Result<Option<(Self, usize)>, String> {
        let mut reader = Reader { bytes, at: 0 };
        match Self::read(&mut reader) {
            Ok(record) => Ok(Some((record, reader.at))),
            Err(Fault::Incomplete) => Ok(None),
            Err(Fault::Malformed(reason)) => Err(reason),
        }
    }

    fn read(reader: &mut Reader<'_>) -> Result<Self, Fault> {
        Ok(match reader.u8()? {
            HELLO => Self::Hello { version: reader.u8()?, token: reader.take()? },
            OBSERVE => Self::Observe,
            PRESS => {
                let id = reader.u32()?;
                let route = reader.route()?;
                let input = match (reader.u8()?, u16::from_le_bytes(reader.take()?)) {
                    (0, code) => Input::Key(code),
                    (1, number) => Input::Button(u8::try_from(number).map_err(|_| {
                        Fault::Malformed(format!("button {number} out of range"))
                    })?),
                    (kind, _) => return Err(Fault::Malformed(format!("unknown input {kind}"))),
                };
                let text = match reader.u8()? {
                    0 => None,
                    1 => Some(reader.text()?),
                    flag => return Err(Fault::Malformed(format!("unknown text flag {flag}"))),
                };
                Self::Press { id, route, input, text }
            }
            UPDATE => Self::Update { id: reader.u32()?, route: reader.route()? },
            RELEASE => Self::Release { id: reader.u32()? },
            tag => return Err(Fault::Malformed(format!("unknown record {tag}"))),
        })
    }
}

fn put_route(out: &mut Vec<u8>, route: Route) {
    match route {
        Route::Hid => out.push(0),
        Route::Keyboard(pid) => {
            out.push(1);
            out.extend_from_slice(&pid.to_le_bytes());
        }
        Route::Window { pid, wid, x, y } => {
            out.push(2);
            out.extend_from_slice(&pid.to_le_bytes());
            out.extend_from_slice(&wid.to_le_bytes());
            out.extend_from_slice(&x.to_le_bytes());
            out.extend_from_slice(&y.to_le_bytes());
        }
    }
}

enum Fault {
    Incomplete,
    Malformed(String),
}

struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl Reader<'_> {
    fn take<const N: usize>(&mut self) -> Result<[u8; N], Fault> {
        let value = self
            .bytes
            .get(self.at..self.at + N)
            .and_then(|slice| <[u8; N]>::try_from(slice).ok())
            .ok_or(Fault::Incomplete)?;
        self.at += N;
        Ok(value)
    }

    fn u8(&mut self) -> Result<u8, Fault> {
        self.take::<1>().map(|[byte]| byte)
    }

    fn u32(&mut self) -> Result<u32, Fault> {
        self.take().map(u32::from_le_bytes)
    }

    fn i32(&mut self) -> Result<i32, Fault> {
        self.take().map(i32::from_le_bytes)
    }

    fn f64(&mut self) -> Result<f64, Fault> {
        self.take().map(f64::from_le_bytes)
    }

    fn route(&mut self) -> Result<Route, Fault> {
        match self.u8()? {
            0 => Ok(Route::Hid),
            1 => Ok(Route::Keyboard(self.i32()?)),
            2 => Ok(Route::Window { pid: self.i32()?, wid: self.u32()?, x: self.f64()?, y: self.f64()? }),
            kind => Err(Fault::Malformed(format!("unknown route {kind}"))),
        }
    }

    fn text(&mut self) -> Result<String, Fault> {
        let length = usize::try_from(self.u32()?).unwrap_or(usize::MAX);
        if length > MAX_TEXT {
            return Err(Fault::Malformed(format!("text of {length} bytes is too long")));
        }
        let bytes = self.bytes.get(self.at..self.at + length).ok_or(Fault::Incomplete)?;
        let text = String::from_utf8(bytes.to_vec())
            .map_err(|_| Fault::Malformed("text is not UTF-8".to_owned()))?;
        self.at += length;
        Ok(text)
    }
}
