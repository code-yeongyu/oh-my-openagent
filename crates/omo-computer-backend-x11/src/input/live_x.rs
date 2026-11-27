//! A private `Xvfb` per live leg, read through an independent connection: a leg's key presses
//! never reach another test's server.

use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};

use x11rb::connection::Connection;
use x11rb::protocol::xproto::ConnectionExt as _;
use x11rb::rust_connection::RustConnection;

use super::connection::InputConnection;
use super::server::{is_down, InputServer};
use super::{InputSettings, X11Input};

/// A private `Xvfb`, killed on drop.
pub(super) struct PrivateX {
    server: Child,
    pub(super) display: String,
}

impl PrivateX {
    pub(super) fn start() -> Self {
        let mut server = Command::new("Xvfb")
            .args([
                "-displayfd",
                "1",
                "-nolisten",
                "tcp",
                "-screen",
                "0",
                "1024x768x24",
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("Xvfb is installed");
        let mut line = String::new();
        BufReader::new(server.stdout.take().expect("stdout"))
            .read_line(&mut line)
            .expect("display number");
        Self {
            server,
            display: format!(":{}", line.trim()),
        }
    }

    pub(super) fn oracle(&self) -> RustConnection {
        x11rb::connect(Some(&self.display))
            .expect("oracle connection")
            .0
    }

    pub(super) fn input(&self, settings: InputSettings) -> X11Input<Box<dyn InputServer>> {
        let connection =
            InputConnection::connect(&self.display).expect("XTEST and XKB on the display");
        X11Input::new(Box::new(connection), settings)
    }
}

impl Drop for PrivateX {
    fn drop(&mut self) {
        if let Err(error) = self
            .server
            .kill()
            .and_then(|()| self.server.wait().map(drop))
        {
            eprintln!("Xvfb {} did not stop: {error}", self.display);
        }
    }
}

pub(super) fn down(oracle: &RustConnection) -> Vec<u8> {
    let bits = oracle
        .query_keymap()
        .expect("query")
        .reply()
        .expect("keymap")
        .keys;
    (0..=u8::MAX).filter(|code| is_down(&bits, *code)).collect()
}

pub(super) fn mapping(oracle: &RustConnection) -> Vec<u32> {
    let (min, max) = (oracle.setup().min_keycode, oracle.setup().max_keycode);
    oracle
        .get_keyboard_mapping(min, max - min + 1)
        .expect("mapping")
        .reply()
        .expect("reply")
        .keysyms
}
