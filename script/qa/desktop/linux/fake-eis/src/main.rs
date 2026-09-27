//! `senpi-qa-fake-eis <socket> [bursts]`: listens on `<socket>` with the
//! recording fake EIS server the wayland backend's tests use (the file is
//! included, not copied), serves the one client that connects, and once that
//! client finished `bursts` (default 1) emulation bursts prints the recorded
//! log as one JSON line on stdout. It is the independent observer behind the
//! `wayland-input-with-optin` scenario of `script/qa/desktop/linux.ts`.

use std::os::unix::net::UnixListener;
use std::process::ExitCode;
use std::time::Duration;

#[expect(dead_code, reason = "the socket-pair server half is only used by the backend's tests")]
#[path = "../../../../../../crates/senpi-desktop-backend-wayland/src/test_support/fake_eis.rs"]
mod fake_eis;

use fake_eis::{EisConfig, FakeEis, Log, Recorded};

/// Read by `fake_eis` as `super::HANG_GUARD`: the bound on every wait.
const HANG_GUARD: Duration = Duration::from_secs(30);

/// The `us,fr` keymap from the backend's testdata, group 0 (`us`) active.
const US_FR: &str = include_str!("../../../../../../crates/senpi-desktop-backend-wayland/testdata/us-fr.xkb");

fn event_json(event: &Recorded) -> String {
    match event {
        Recorded::Key { keycode, pressed } => {
            format!(r#"{{"kind":"key","keycode":{keycode},"pressed":{pressed}}}"#)
        }
        Recorded::Button { code, pressed } => {
            format!(r#"{{"kind":"button","code":{code},"pressed":{pressed}}}"#)
        }
        Recorded::Motion { x, y } => format!(r#"{{"kind":"motion","x":{x},"y":{y}}}"#),
    }
}

fn log_json(log: &Log) -> String {
    let events: Vec<String> = log.events.iter().map(event_json).collect();
    let error = log
        .error
        .as_ref()
        .map_or_else(|| "null".to_owned(), |error| format!("{error:?}"));
    format!(
        r#"{{"connected":{},"bursts":{},"events":[{}],"error":{error}}}"#,
        log.connected,
        log.bursts,
        events.join(",")
    )
}

fn main() -> ExitCode {
    let mut args = std::env::args().skip(1);
    let Some(socket) = args.next() else {
        eprintln!("usage: senpi-qa-fake-eis <socket> [bursts]");
        return ExitCode::from(2);
    };
    let bursts = match args.next().map(|value| value.parse::<usize>()) {
        None => 1,
        Some(Ok(bursts)) => bursts,
        Some(Err(error)) => {
            eprintln!("bursts: {error}");
            return ExitCode::from(2);
        }
    };
    let listener = match UnixListener::bind(&socket) {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!("bind {socket}: {error}");
            return ExitCode::from(1);
        }
    };
    eprintln!("listening {socket}");
    let eis = FakeEis::listen(
        listener,
        EisConfig {
            keymap: US_FR,
            group: 0,
        },
    );
    let log = eis.wait_for(|log| log.bursts >= bursts);
    println!("{}", log_json(&log));
    if log.error.is_some() {
        ExitCode::from(1)
    } else {
        ExitCode::SUCCESS
    }
}
