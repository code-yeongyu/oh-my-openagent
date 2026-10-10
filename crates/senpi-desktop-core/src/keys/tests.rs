use super::*;
use crate::error::ErrorCode;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum KeyDirection {
    Press,
    Release,
    Click,
}

fn execute_chord_with<E>(
    keys: &[KeyName],
    mut emit: impl FnMut(KeyName, KeyDirection) -> Result<(), E>,
) -> Result<(), E> {
    if keys.len() == 1 {
        return emit(keys[0], KeyDirection::Click);
    }
    let mut pressed = Vec::with_capacity(keys.len());
    for &key in keys {
        if let Err(error) = emit(key, KeyDirection::Press) {
            for &held in pressed.iter().rev() {
                let _ = emit(held, KeyDirection::Release);
            }
            return Err(error);
        }
        pressed.push(key);
    }
    let mut first_error = None;
    for &key in pressed.iter().rev() {
        if let Err(error) = emit(key, KeyDirection::Release) {
            if first_error.is_none() {
                first_error = Some(error);
            }
        }
    }
    first_error.map_or(Ok(()), Err)
}

#[test]
fn parses_full_alias_table() {
    let cases = [
        (
            &["cmd", "META", "super", "win", "windows", "command"][..],
            KeyName::Meta,
        ),
        (&["option", "alt"][..], KeyName::Alt),
        (&["control", "ctrl"][..], KeyName::Ctrl),
        (&["enter", "return"][..], KeyName::Enter),
        (&["esc", "escape"][..], KeyName::Escape),
        (&["delete", "del"][..], KeyName::Delete),
        (&["up", "arrowup"][..], KeyName::Up),
        (&["down", "arrowdown"][..], KeyName::Down),
        (&["left", "arrowleft"][..], KeyName::Left),
        (&["right", "arrowright"][..], KeyName::Right),
        (&["printscreen", "printscr"][..], KeyName::PrintScreen),
    ];
    for (aliases, expected) in cases {
        for alias in aliases {
            assert_eq!(parse_key(alias).unwrap(), expected);
        }
    }
    assert_eq!(
        parse_keys(&["cmd+shift+p".into()]).unwrap(),
        [KeyName::Meta, KeyName::Shift, KeyName::Char('p')]
    );
    assert_eq!(parse_key("garbage").unwrap_err().code, ErrorCode::InvalidKey);
}

#[test]
fn presses_in_order_and_releases_in_reverse_even_after_errors() {
    let keys = [KeyName::Ctrl, KeyName::Shift, KeyName::Char('p')];
    let mut events = Vec::new();
    execute_chord_with(&keys, |key, direction| {
        events.push((key, direction));
        Ok::<_, ()>(())
    })
    .unwrap();
    assert_eq!(
        events,
        [
            (KeyName::Ctrl, KeyDirection::Press),
            (KeyName::Shift, KeyDirection::Press),
            (KeyName::Char('p'), KeyDirection::Press),
            (KeyName::Char('p'), KeyDirection::Release),
            (KeyName::Shift, KeyDirection::Release),
            (KeyName::Ctrl, KeyDirection::Release)
        ]
    );
    let mut events = Vec::new();
    let _ = execute_chord_with(&keys, |key, direction| {
        events.push((key, direction));
        if key == KeyName::Char('p') && direction == KeyDirection::Press {
            Err(())
        } else {
            Ok(())
        }
    });
    assert_eq!(
        events[3..],
        [
            (KeyName::Shift, KeyDirection::Release),
            (KeyName::Ctrl, KeyDirection::Release)
        ]
    );
}
