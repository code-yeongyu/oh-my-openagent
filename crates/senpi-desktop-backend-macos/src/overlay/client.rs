//! Session-owned helper; failure disables it rather than respawning per action.
use super::wire::{self, Command as Message, Reply};
use std::io;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::time::{Duration, Instant};

const DEADLINE: Duration = Duration::from_secs(2);

#[derive(Debug)]
pub(super) struct Helper {
    child: Child,
    input: ChildStdin,
    replies: Receiver<io::Result<Reply>>,
}

impl Helper {
    pub fn start() -> io::Result<Self> {
        let mut child = Command::new(std::env::current_exe()?)
            .arg("--cursor-overlay")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()?;
        let input = child
            .stdin
            .take()
            .ok_or_else(|| io::Error::other("overlay stdin missing"))?;
        let mut output = child
            .stdout
            .take()
            .ok_or_else(|| io::Error::other("overlay stdout missing"))?;
        let (sender, replies) = mpsc::sync_channel(1);
        let mut helper = Self {
            child,
            input,
            replies,
        };
        std::thread::Builder::new()
            .name("cursor-overlay-replies".to_owned())
            .spawn(move || loop {
                let reply = wire::read::<Reply>(&mut output);
                let finished = reply.is_err();
                if sender.send(reply).is_err() || finished {
                    break;
                }
            })?;
        helper.receive(0)?;
        helper.send(Message::Probe { token: 1 })?;
        Ok(helper)
    }

    pub fn pid(&self) -> u32 {
        self.child.id()
    }

    pub fn send(&mut self, command: Message) -> io::Result<Reply> {
        let token = command.token();
        wire::write(&mut self.input, &command)?;
        self.receive(token)
    }

    fn receive(&self, token: u64) -> io::Result<Reply> {
        let reply = self
            .replies
            .recv_timeout(DEADLINE)
            .map_err(io::Error::other)??;
        if reply.token != token
            || reply.pid != self.pid()
            || reply.window_id == 0
            || !reply.ignores_mouse_events
            || reply.can_become_key
            || reply.can_become_main
        {
            return Err(io::Error::other("invalid cursor overlay acknowledgement"));
        }
        Ok(reply)
    }
}

impl Drop for Helper {
    fn drop(&mut self) {
        if let Err(error) = self.child.kill() {
            if error.kind() != io::ErrorKind::InvalidInput {
                eprintln!("cursor-overlay: terminate failed: {error}");
            }
        }
        let deadline = Instant::now() + DEADLINE;
        loop {
            match self.child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(5))
                }
                Ok(None) => {
                    eprintln!("cursor-overlay: process did not exit before deadline");
                    break;
                }
                Err(error) => {
                    eprintln!("cursor-overlay: reaping failed: {error}");
                    break;
                }
            }
        }
    }
}
