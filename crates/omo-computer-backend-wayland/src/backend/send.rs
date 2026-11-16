//! One input event to libei frames: resolved and admitted completely before anything is sent,
//! so a refusal always means nothing went out.

use omo_computer_core::backend::{BackendResult, Delivered, InputEvent, Refusal};
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::params::{Button, Point};

use crate::input::{preflight, Emit, Input};
use crate::xkb::{Keymap, Stroke, Unresolved};

const BTN_LEFT: u32 = 0x110;
const BTN_RIGHT: u32 = 0x111;
const BTN_MIDDLE: u32 = 0x112;
/// libei discrete scroll counts 120ths of a detent.
const DETENT: f64 = 120.0;

fn unresolved(error: Unresolved) -> Refusal {
    match error {
        Unresolved::Glyph { grapheme, group } => {
            Refusal::new(EngineCode::InvalidKey, Reason::Unresolvable).with_data(
                serde_json::json!({ "grapheme": grapheme, "group": group, "nextCall": "paste" }),
            )
        }
        Unresolved::UnknownKey(key) => Refusal::new(EngineCode::InvalidKey, Reason::UnknownKey)
            .with_data(serde_json::json!({ "key": key })),
    }
}

fn no_keymap() -> Refusal {
    Refusal::new(EngineCode::Internal, Reason::InputUnsupported)
}

fn stroke_events(stroke: Stroke, out: &mut Vec<Emit>) {
    let modifiers: Vec<u32> = [stroke.shift, stroke.level3]
        .into_iter()
        .flatten()
        .collect();
    out.extend(modifiers.iter().map(|key| Emit::Key {
        key: *key,
        down: true,
    }));
    out.push(Emit::Key {
        key: stroke.key,
        down: true,
    });
    out.push(Emit::Key {
        key: stroke.key,
        down: false,
    });
    out.extend(modifiers.iter().rev().map(|key| Emit::Key {
        key: *key,
        down: false,
    }));
}

fn typed(keymap: &mut Keymap, group: u32, text: &str) -> Result<(Vec<Emit>, u32), Refusal> {
    let mut events = Vec::new();
    let mut units = 0_u32;
    for ch in text.chars() {
        stroke_events(
            keymap.resolve_char(ch, group).map_err(unresolved)?,
            &mut events,
        );
        units += 1;
    }
    Ok((events, units))
}

const fn button_code(button: Button) -> u32 {
    match button {
        Button::Left => BTN_LEFT,
        Button::Right => BTN_RIGHT,
        Button::Middle => BTN_MIDDLE,
    }
}

#[expect(
    clippy::cast_possible_truncation,
    reason = "libei carries f32 logical coordinates and i32 detent counts; desktop values fit"
)]
fn plan(input: &mut Input, event: &InputEvent) -> Result<(Vec<Emit>, u32, Option<Point>), Refusal> {
    let (session, keymap) = input.with_keymap()?;
    let group = session.group();
    match event {
        InputEvent::Text(text) => {
            let (events, units) = typed(keymap.ok_or_else(no_keymap)?, group, text)?;
            Ok((events, units, None))
        }
        InputEvent::Key { key, down } => {
            let code = keymap
                .ok_or_else(no_keymap)?
                .resolve_key(key, group)
                .map_err(unresolved)?;
            Ok((
                vec![Emit::Key {
                    key: code,
                    down: *down,
                }],
                1,
                None,
            ))
        }
        InputEvent::PointerMove(point) => {
            preflight(&session.regions(), &[*point])?;
            Ok((
                vec![Emit::MotionAbsolute {
                    x: point.x as f32,
                    y: point.y as f32,
                }],
                1,
                Some(*point),
            ))
        }
        InputEvent::Button { button, down } => {
            if session.regions().is_empty() {
                return Err(Refusal::new(
                    EngineCode::InvalidCoordinateFrame,
                    Reason::PixelsOnly,
                ));
            }
            Ok((
                vec![Emit::Button {
                    button: button_code(*button),
                    down: *down,
                }],
                1,
                None,
            ))
        }
        InputEvent::Scroll { dx, dy } => Ok((
            vec![Emit::Scroll {
                dx: (dx * DETENT).round() as i32,
                dy: (dy * DETENT).round() as i32,
            }],
            1,
            None,
        )),
        InputEvent::MenuSelect { .. }
        | InputEvent::AppLaunch { .. }
        | InputEvent::AppQuit { .. }
        | InputEvent::OpenSurface { .. } => {
            Err(Refusal::new(EngineCode::Internal, Reason::InputUnsupported))
        }
    }
}

/// Resolves, admits and sends one event.
pub fn post(input: &mut Input, event: &InputEvent) -> BackendResult<Delivered> {
    let (events, units, point) = plan(input, event)?;
    input.emit(&events)?;
    if point.is_some() {
        input.last_point = point;
    }
    Ok(Delivered {
        count: units,
        of: units,
    })
}
