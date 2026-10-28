use super::wire::{Input, Lane, Record, Route, TOKEN_LEN, VERSION};

fn decode_all(bytes: &[u8]) -> Vec<Record> {
    let mut decoded = Vec::new();
    let mut at = 0;
    while let Some((record, length)) = Record::decode(&bytes[at..]).expect("valid stream") {
        decoded.push(record);
        at += length;
    }
    decoded
}

fn stream(records: &[Record]) -> Vec<u8> {
    let mut bytes = Vec::new();
    for record in records {
        record.encode(&mut bytes);
    }
    bytes
}

#[test]
fn records_survive_the_stream_and_a_cut_tail_is_not_a_record() {
    let records = [
        Record::Hello { version: VERSION, token: [7; TOKEN_LEN] },
        Record::Observe,
        Record::Press { id: 7, route: Route::Keyboard(4321), input: Input::Key(56), text: None },
        Record::Press { id: 8, route: Route::Hid, input: Input::Key(0), text: Some("\u{e9}".to_owned()) },
        Record::Press {
            id: 9,
            route: Route::Window { pid: 4321, wid: 12, x: 1.5, y: -2.0 },
            input: Input::Button(2),
            text: None,
        },
        Record::Update { id: 9, route: Route::Window { pid: 4321, wid: 12, x: 300.0, y: 40.25 } },
        Record::Release { id: 7 },
    ];
    let bytes = stream(&records);
    assert_eq!(decode_all(&bytes), records);
    // A process killed mid-write leaves a partial record, which posted
    // nothing yet: presses are written before they are posted.
    assert_eq!(decode_all(&bytes[..bytes.len() - 1]), records[..6]);
}

#[test]
fn a_malformed_stream_is_an_error_not_a_record() {
    assert!(Record::decode(b"X").is_err(), "unknown record");
    assert!(Record::decode(&[b'U', 1, 0, 0, 0, 9]).is_err(), "unknown route");
    let mut press = Vec::new();
    Record::Press { id: 1, route: Route::Hid, input: Input::Key(0), text: Some("a".to_owned()) }.encode(&mut press);
    let text_at = press.len() - 1;
    press[text_at] = 0xff;
    assert!(Record::decode(&press).is_err(), "text that is not UTF-8");
    let mut long = vec![b'P', 1, 0, 0, 0, 0, 0, 0, 0, 1];
    long.extend_from_slice(&65u32.to_le_bytes());
    long.extend_from_slice(&[b'a'; 65]);
    assert!(Record::decode(&long).is_err(), "text longer than a character");
    assert!(Record::decode(&[b'P', 1, 0, 0, 0, 0, 9, 0, 0]).is_err(), "unknown input");
}

#[test]
fn an_incomplete_record_waits_for_more_bytes() {
    assert_eq!(Record::decode(&[]), Ok(None));
    assert_eq!(Record::decode(&[b'H', VERSION, 1, 2]), Ok(None));
    assert_eq!(Record::decode(&[b'R', 1, 0]), Ok(None));
}

#[test]
fn a_lane_ignores_where_a_pointer_release_lands() {
    let start = Route::Window { pid: 9, wid: 3, x: 1.0, y: 1.0 };
    let dragged = Route::Window { pid: 9, wid: 3, x: 80.0, y: 1.0 };
    assert_eq!(start.lane(), dragged.lane());
    assert_eq!(start.lane(), Lane::Window(9, 3));
    assert_ne!(Route::Keyboard(9).lane(), Route::Keyboard(10).lane());
    assert_eq!(Route::Hid.lane(), Lane::Hid);
}
