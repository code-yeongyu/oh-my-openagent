//! The line client of the capture helper over any byte pipe (the helper's stdio on macOS).

use std::io::{BufRead, Read, Write};

use super::protocol::{HelperError, HelperFrame, HelperReply, HelperRequest};
use crate::capture::seam::CaptureHelper;
use crate::capture::types::CaptureFault;

/// The most frame bytes one reply may announce; more is a protocol fault.
pub const MAX_FRAME_BYTES: usize = 64 * 1024 * 1024;

/// A helper reached through a reader and a writer.
pub struct LineHelper<R, W> {
    reader: R,
    writer: W,
}

impl<R: BufRead + Send, W: Write + Send> LineHelper<R, W> {
    pub const fn new(reader: R, writer: W) -> Self {
        Self { reader, writer }
    }

    /// The reader and the writer, for a caller that inspects what was sent.
    pub fn into_parts(self) -> (R, W) {
        (self.reader, self.writer)
    }

    fn send(&mut self, request: &HelperRequest) -> Result<(), CaptureFault> {
        let mut line = serde_json::to_vec(request).map_err(|_| CaptureFault::Protocol)?;
        line.push(b'\n');
        self.writer
            .write_all(&line)
            .and_then(|()| self.writer.flush())
            .map_err(|_| CaptureFault::HelperGone)
    }

    fn receive(&mut self, id: u64) -> Result<HelperFrame, CaptureFault> {
        let mut line = String::new();
        match self.reader.read_line(&mut line) {
            Ok(0) | Err(_) => return Err(CaptureFault::HelperGone),
            Ok(_) => {}
        }
        let reply: HelperReply =
            serde_json::from_str(line.trim_end()).map_err(|_| CaptureFault::Protocol)?;
        if reply.id != id || reply.png_bytes > MAX_FRAME_BYTES {
            return Err(CaptureFault::Protocol);
        }
        let mut png = vec![0; reply.png_bytes];
        self.reader
            .read_exact(&mut png)
            .map_err(|_| CaptureFault::HelperGone)?;
        if !reply.ok {
            return Err(match reply.error {
                Some(HelperError::Denied) => CaptureFault::Denied,
                Some(HelperError::Timeout) => CaptureFault::Timeout,
                Some(HelperError::NullFrame | HelperError::NotFound) => CaptureFault::NullFrame,
                None => CaptureFault::Protocol,
            });
        }
        Ok(HelperFrame { reply, png })
    }
}

impl<R: BufRead + Send, W: Write + Send> CaptureHelper for LineHelper<R, W> {
    fn call(&mut self, request: &HelperRequest) -> Result<HelperFrame, CaptureFault> {
        self.send(request)?;
        self.receive(request.id())
    }
}
