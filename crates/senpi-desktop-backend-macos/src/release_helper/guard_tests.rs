use std::cell::{Cell, RefCell};
use std::io::{self, Read, Write};
use std::os::unix::net::UnixStream;
use std::time::Duration;

use super::guard::{Helper, Ledger};
use super::wire::{Input, Lane, Record, Route, READY};

thread_local! {
    /// The far end of the last test peer's stream.
    static PEER: RefCell<Option<UnixStream>> = const { RefCell::new(None) };
    static CONNECTS: Cell<u32> = const { Cell::new(0) };
}

fn peer_with(ready: bool, answer: Option<u8>) -> io::Result<Helper> {
    CONNECTS.set(CONNECTS.get() + 1);
    let (socket, mut theirs) = UnixStream::pair()?;
    if let Some(answer) = answer {
        theirs.write_all(&[answer])?;
    }
    PEER.set(Some(theirs));
    Ok(Helper::new(None, socket, ready))
}

/// A helper that already follows the user.
fn peer() -> io::Result<Helper> {
    peer_with(true, None)
}

/// A helper that answers READY once told to observe.
fn answering_peer() -> io::Result<Helper> {
    peer_with(false, Some(READY))
}

/// A helper that never answers.
fn silent_peer() -> io::Result<Helper> {
    peer_with(false, None)
}

fn unavailable() -> io::Result<Helper> {
    CONNECTS.set(CONNECTS.get() + 1);
    Err(io::Error::other("no helper"))
}

/// Everything the peer received; the ledger's end of the stream is already
/// closed, so the read ends.
fn received() -> Vec<Record> {
    let mut peer = PEER.take().expect("a helper was started");
    let mut bytes = Vec::new();
    peer.read_to_end(&mut bytes).expect("the stream ends");
    let mut records = Vec::new();
    let mut at = 0;
    while let Some((record, length)) = Record::decode(&bytes[at..]).expect("valid stream") {
        records.push(record);
        at += length;
    }
    records
}

#[test]
fn a_request_streams_presses_moves_and_releases_and_nothing_runs_outside_one() {
    let mut ledger = Ledger::with_connect(peer);
    ledger.press(Route::Keyboard(9), Input::Key(56), None);
    assert!(PEER.with_borrow(Option::is_none), "no helper outside a request");
    ledger.begin();
    ledger.press(Route::Keyboard(9), Input::Key(56), None);
    ledger.press(Route::Keyboard(9), Input::Key(0), Some("a"));
    ledger.press(Route::Window { pid: 9, wid: 4, x: 1.0, y: 1.0 }, Input::Button(0), None);
    ledger.moved(Route::Window { pid: 9, wid: 4, x: 5.0, y: 6.0 }, Input::Button(0));
    ledger.moved(Route::Window { pid: 9, wid: 5, x: 5.0, y: 6.0 }, Input::Button(0));
    ledger.released(Lane::Keyboard(9), Input::Key(0));
    ledger.released(Lane::Window(9, 4), Input::Button(0));
    ledger.end().expect("the outermost request ends the stream").finish_within(Duration::ZERO);
    assert_eq!(received(), [
        Record::Press { id: 0, route: Route::Keyboard(9), input: Input::Key(56), text: None },
        Record::Press { id: 1, route: Route::Keyboard(9), input: Input::Key(0), text: Some("a".to_owned()) },
        Record::Press { id: 2, route: Route::Window { pid: 9, wid: 4, x: 1.0, y: 1.0 }, input: Input::Button(0), text: None },
        Record::Update { id: 2, route: Route::Window { pid: 9, wid: 4, x: 5.0, y: 6.0 } },
        Record::Release { id: 1 },
        Record::Release { id: 2 },
    ]);
}

#[test]
fn only_the_outermost_request_ends_the_stream() {
    let mut ledger = Ledger::with_connect(peer);
    ledger.begin();
    ledger.begin();
    ledger.press(Route::Keyboard(9), Input::Key(56), None);
    assert!(ledger.end().is_none(), "an inner request leaves the stream open");
    ledger.end().expect("the outermost request ends it").finish_within(Duration::ZERO);
    assert_eq!(received().len(), 1);
}

#[test]
fn a_hid_press_goes_out_once_the_helper_follows_the_user() {
    let mut ledger = Ledger::with_connect(answering_peer);
    ledger.begin();
    ledger.press(Route::Hid, Input::Key(56), None);
    ledger.press(Route::Hid, Input::Button(0), None);
    ledger.end().expect("stream").finish_within(Duration::ZERO);
    assert_eq!(received(), [
        Record::Observe,
        Record::Press { id: 0, route: Route::Hid, input: Input::Key(56), text: None },
        Record::Press { id: 1, route: Route::Hid, input: Input::Button(0), text: None },
    ]);
}

#[test]
fn a_helper_that_never_follows_the_user_is_abandoned_before_the_first_hid_press() {
    let mut ledger = Ledger::with_connect(silent_peer);
    ledger.begin();
    ledger.press(Route::Hid, Input::Key(56), None);
    ledger.press(Route::Hid, Input::Key(0), None);
    assert!(ledger.end().is_none(), "the abandoned helper is gone");
    assert_eq!(received(), [Record::Observe]);
    assert_eq!(CONNECTS.get(), 1, "the request goes on without a new helper");
}

#[test]
fn a_request_runs_unguarded_when_the_helper_cannot_start() {
    let mut ledger = Ledger::with_connect(unavailable);
    ledger.begin();
    ledger.press(Route::Keyboard(9), Input::Key(56), None);
    ledger.press(Route::Keyboard(9), Input::Key(0), None);
    assert!(ledger.end().is_none());
    assert_eq!(CONNECTS.get(), 1, "one failed start, not one per press");
    ledger.begin();
    ledger.press(Route::Keyboard(9), Input::Key(56), None);
    assert_eq!(CONNECTS.get(), 2, "the next request tries again");
}
