//! The fake EIS server as a process, for the Linux QA driver's Wayland scenarios: it binds
//! `<dir>/eis-fake`, feeds the keymap file it is given, and rewrites `<dir>/fake-eis.json`
//! (its observer log) every 50 ms until it is killed.
//!
//!   omo-fake-eis <dir> <keymap file> <serve|drop-once|second-client-refused> [x,y,w,h ...]

use std::path::PathBuf;
use std::time::Duration;

use omo_computer_backend_wayland::fake::{FakeEis, FakeRegion, Log, Mode, Script};

fn region(spec: &str) -> Option<FakeRegion> {
    let mut parts = spec.split(',').map(str::parse::<u32>);
    let (Some(Ok(x)), Some(Ok(y)), Some(Ok(width)), Some(Ok(height))) = (parts.next(), parts.next(), parts.next(), parts.next()) else {
        return None;
    };
    Some(FakeRegion { x, y, width, height })
}

fn json(log: &Log) -> serde_json::Value {
    serde_json::json!({
        "connections": log.connections,
        "refused": log.refused,
        "dropped": log.dropped,
        "frames": log.frames,
        "keys": log.keys.len(),
        "motions": log.motions.len(),
        "buttons": log.buttons.len(),
        "held": log.held,
        "keymapsFed": log.keymaps_fed,
    })
}

fn main() -> std::process::ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [dir, keymap, mode, regions @ ..] = args.as_slice() else {
        eprintln!("usage: omo-fake-eis <dir> <keymap file> <serve|drop-once|second-client-refused> [x,y,w,h ...]");
        return std::process::ExitCode::from(2);
    };
    let mode = match mode.as_str() {
        "serve" => Mode::Serve,
        "drop-once" => Mode::DropOnce,
        "second-client-refused" => Mode::SecondClientRefused,
        other => {
            eprintln!("omo-fake-eis: unknown mode {other}");
            return std::process::ExitCode::from(2);
        }
    };
    let keymap = match std::fs::read_to_string(keymap) {
        Ok(text) => text,
        Err(error) => {
            eprintln!("omo-fake-eis: {keymap}: {error}");
            return std::process::ExitCode::from(2);
        }
    };
    let regions = regions.iter().filter_map(|spec| region(spec)).collect();
    let dir = PathBuf::from(dir);
    let eis = match FakeEis::start(&dir, Script { keymap, regions, mode, keyboard: true }) {
        Ok(eis) => eis,
        Err(error) => {
            eprintln!("omo-fake-eis: bind {}: {error}", dir.display());
            return std::process::ExitCode::from(1);
        }
    };
    println!("{}", eis.socket().display());
    let out = dir.join("fake-eis.json");
    let staging = dir.join("fake-eis.json.tmp");
    loop {
        let body = json(&eis.log()).to_string();
        if std::fs::write(&staging, body).and_then(|()| std::fs::rename(&staging, &out)).is_err() {
            eprintln!("omo-fake-eis: cannot write {}", out.display());
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}
