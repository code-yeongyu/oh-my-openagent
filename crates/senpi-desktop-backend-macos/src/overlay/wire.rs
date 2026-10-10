//! Private bounded IPC, outside the desktop engine RPC method catalog.
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::io::{self, Read, Write};

const MAX_FRAME: usize = 4096;

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "action", deny_unknown_fields)]
pub(super) enum Command {
    Probe { token: u64 },
    Target { token: u64, x: f64, y: f64 },
    Hide { token: u64 },
    Resume { token: u64 },
}

impl Command {
    pub fn token(&self) -> u64 {
        match self {
            Self::Probe { token }
            | Self::Target { token, .. }
            | Self::Hide { token }
            | Self::Resume { token } => *token,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Reply {
    pub token: u64,
    pub pid: u32,
    pub window_id: u32,
    pub visible: bool,
    pub ignores_mouse_events: bool,
    pub can_become_key: bool,
    pub can_become_main: bool,
}

pub(super) fn read<T: DeserializeOwned>(reader: &mut impl Read) -> io::Result<T> {
    let mut length = [0; 4];
    reader.read_exact(&mut length)?;
    let length = usize::try_from(u32::from_be_bytes(length)).map_err(io::Error::other)?;
    if length > MAX_FRAME {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "overlay IPC frame too large",
        ));
    }
    let mut data = vec![0; length];
    reader.read_exact(&mut data)?;
    serde_json::from_slice(&data).map_err(io::Error::other)
}

pub(super) fn write(writer: &mut impl Write, value: &impl Serialize) -> io::Result<()> {
    let data = serde_json::to_vec(value).map_err(io::Error::other)?;
    if data.len() > MAX_FRAME {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "overlay IPC frame too large",
        ));
    }
    writer.write_all(
        &u32::try_from(data.len())
            .map_err(io::Error::other)?
            .to_be_bytes(),
    )?;
    writer.write_all(&data)?;
    writer.flush()
}
