//! The hit-test walk behind the live `DeliveryOs::child_at`, over the three user32 reads it makes,
//! so the walk runs on every OS: from the addressed window down to the deepest enabled, visible
//! child under a screen point, with the point in that child's client coordinates.

use omo_computer_core::params::Point;

use super::target::{coordinate, ClientPoint};

/// The walk stops after this many levels.
const MAX_DEPTH: usize = 32;

/// The Windows reads of the walk.
pub trait HitOs {
    /// `ScreenToClient(window, screen)`.
    fn to_client(&self, window: isize, screen: (i32, i32)) -> Option<(i32, i32)>;
    /// `GetClientRect(window)`: the client area's width and height.
    fn client_size(&self, window: isize) -> Option<(i32, i32)>;
    /// `ChildWindowFromPointEx(window, client, CWP_SKIPINVISIBLE | CWP_SKIPDISABLED |
    /// CWP_SKIPTRANSPARENT)`: the child under the point, `window` itself over no child, `None`
    /// (NULL) for a point outside `window`.
    fn child_from_point(&self, window: isize, client: (i32, i32)) -> Option<isize>;
}

/// The deepest child of `top` under the screen point `at`, with the point in its client
/// coordinates; `None` outside `top` or out of the message range.
#[must_use]
pub fn deepest_child(os: &dyn HitOs, top: isize, at: Point) -> Option<(isize, ClientPoint)> {
    let screen = (i32::from(coordinate(at.x)?), i32::from(coordinate(at.y)?));
    let mut current = top;
    let mut client = os.to_client(current, screen)?;
    for _ in 0..MAX_DEPTH {
        match os.child_from_point(current, client) {
            Some(child) if child != current => {
                current = child;
                client = os.to_client(current, screen)?;
            }
            _ => break,
        }
    }
    Some((
        current,
        ClientPoint {
            x: i16::try_from(client.0).ok()?,
            y: i16::try_from(client.1).ok()?,
        },
    ))
}
