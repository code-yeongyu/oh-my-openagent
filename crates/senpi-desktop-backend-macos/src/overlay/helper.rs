//! Private helper; EOF closes the panel and ends the process.
use super::{
    motion::Motion,
    panel::CursorPanel,
    wire::{self, Command},
};
use objc2::{rc::autoreleasepool, MainThreadMarker};
use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy, NSScreen};
use objc2_foundation::{NSDate, NSRunLoop};
use std::io;
use std::sync::mpsc::{sync_channel, TryRecvError};
use std::time::{Duration, Instant};

pub(crate) fn run() -> io::Result<()> {
    let mtm =
        MainThreadMarker::new().ok_or_else(|| io::Error::other("overlay requires main thread"))?;
    let app = NSApplication::sharedApplication(mtm);
    if !app.setActivationPolicy(NSApplicationActivationPolicy::Accessory)
        || NSScreen::screens(mtm).count() == 0
    {
        return Err(io::Error::other(
            "cursor overlay needs an interactive GUI session",
        ));
    }
    let panel = CursorPanel::new(mtm);
    let (send, receive) = sync_channel(1);
    let reader = std::thread::Builder::new()
        .name("cursor-overlay-ipc".to_owned())
        .spawn(move || {
            let mut input = io::stdin().lock();
            while let Ok(command) = wire::read::<Command>(&mut input) {
                if send.send(command).is_err() {
                    break;
                }
            }
        })?;
    let mut output = io::stdout().lock();
    let mut motion = Motion::default();
    let started = Instant::now();
    let mut hidden: Option<(u64, Instant)> = None;
    let runloop = NSRunLoop::mainRunLoop();
    runloop.runUntilDate(&NSDate::dateWithTimeIntervalSinceNow(1.0 / 60.0));
    wire::write(&mut output, &panel.reply(0)?)?;
    loop {
        let now_ms = started.elapsed().as_secs_f64() * 1000.0;
        match receive.try_recv() {
            Ok(command) => {
                let token = command.token();
                match command {
                    Command::Probe { .. } => wire::write(&mut output, &panel.reply(token)?)?,
                    Command::Target { x, y, .. } => {
                        if !x.is_finite() || !y.is_finite() {
                            return Err(io::Error::other("non-finite cursor target"));
                        }
                        motion.target(x, y, now_ms);
                        panel.render(motion.frame(now_ms), mtm)?;
                        wire::write(&mut output, &panel.reply(token)?)?;
                    }
                    Command::Hide { .. } => {
                        motion.suspend(token);
                        panel.orderOut(None);
                        hidden = Some((token, Instant::now()));
                    }
                    Command::Resume { .. } => {
                        motion.resume(token);
                        panel.render(motion.frame(now_ms), mtm)?;
                        wire::write(&mut output, &panel.reply(token)?)?;
                    }
                }
            }
            Err(TryRecvError::Empty) => {}
            Err(TryRecvError::Disconnected) => {
                panel.orderOut(None);
                reader
                    .join()
                    .map_err(|_| io::Error::other("overlay reader panicked"))?;
                return Ok(());
            }
        }
        if let Some((token, since)) = hidden {
            // A pipe ACK is not a compositor fence: check WindowServer absence
            // and let its compositor settle before acknowledging capture.
            let absent = crate::focus::window_info()
                .map_err(|error| io::Error::other(error.to_string()))?
                .iter()
                .all(|window| window.pid != std::process::id() || !window.on_screen);
            if absent && since.elapsed() >= Duration::from_millis(50) {
                wire::write(&mut output, &panel.reply(token)?)?;
                hidden = None;
            }
        }
        autoreleasepool(|_| {
            panel.render(motion.frame(now_ms), mtm)?;
            runloop.runUntilDate(&NSDate::dateWithTimeIntervalSinceNow(1.0 / 60.0));
            Ok::<(), io::Error>(())
        })?;
    }
}
