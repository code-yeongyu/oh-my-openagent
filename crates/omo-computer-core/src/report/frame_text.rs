//! A frame read-back as evidence text (R59): `x,y,width,height`, the raw values, and the
//! design row C8 rule over two such texts.

use crate::listing::Rect;

/// A frame as evidence text: `x,y,width,height`, the raw values.
pub(super) fn of(frame: Rect) -> String {
    format!("{},{},{},{}", frame.x, frame.y, frame.width, frame.height)
}

fn frame_of(text: &str) -> Option<[f64; 4]> {
    let mut edges = text.split(',').map(str::parse::<f64>);
    let frame = [edges.next()?.ok()?, edges.next()?.ok()?, edges.next()?.ok()?, edges.next()?.ok()?];
    edges.next().is_none().then_some(frame)
}

/// Design row C8: every edge of the read-back within 1 px of the request.
pub(super) fn within_1px(intended: Option<&str>, value: Option<&str>) -> bool {
    match (intended.and_then(frame_of), value.and_then(frame_of)) {
        (Some(asked), Some(read)) => asked
            .iter()
            .zip(read)
            .all(|(asked, read)| (asked - read).abs() <= crate::window_frame::EDGE_TOLERANCE),
        _ => false,
    }
}
