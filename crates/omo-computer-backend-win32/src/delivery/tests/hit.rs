//! The live `child_at` contract on a scripted screen: the deepest child under the point with the
//! point in that child's client coordinates, and `None` for a point off the addressed window's
//! client area (`ChildWindowFromPointEx` answers NULL outside its parent), so a pointer verb there
//! is refused `no_region` instead of being posted to the frame.

use std::collections::HashMap;

use omo_computer_core::params::Point;

use crate::delivery::hit::{deepest_child, HitOs};
use crate::delivery::target::ClientPoint;

const TOP: isize = 0x600;
const PANEL: isize = 0x601;
const BUTTON: isize = 0x602;

/// A window's client area on the screen and its parent.
struct Rect {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    parent: Option<isize>,
}

struct Screen(HashMap<isize, Rect>);

impl Screen {
    fn new() -> Self {
        let rect = |x, y, width, height, parent| Rect {
            x,
            y,
            width,
            height,
            parent,
        };
        Self(HashMap::from([
            (TOP, rect(100, 100, 400, 300, None)),
            (PANEL, rect(150, 150, 200, 100, Some(TOP))),
            (BUTTON, rect(160, 160, 50, 20, Some(PANEL))),
        ]))
    }

    fn holds(rect: &Rect, screen: (i32, i32)) -> bool {
        (rect.x..rect.x + rect.width).contains(&screen.0)
            && (rect.y..rect.y + rect.height).contains(&screen.1)
    }
}

impl HitOs for Screen {
    fn to_client(&self, window: isize, screen: (i32, i32)) -> Option<(i32, i32)> {
        let rect = self.0.get(&window)?;
        Some((screen.0 - rect.x, screen.1 - rect.y))
    }

    fn client_size(&self, window: isize) -> Option<(i32, i32)> {
        let rect = self.0.get(&window)?;
        Some((rect.width, rect.height))
    }

    fn child_from_point(&self, window: isize, client: (i32, i32)) -> Option<isize> {
        let parent = self.0.get(&window)?;
        let screen = (client.0 + parent.x, client.1 + parent.y);
        if !Self::holds(parent, screen) {
            return None;
        }
        let child = self
            .0
            .iter()
            .find(|(_, rect)| rect.parent == Some(window) && Self::holds(rect, screen))
            .map(|(id, _)| *id);
        Some(child.unwrap_or(window))
    }
}

fn at(x: f64, y: f64) -> Point {
    Point { x, y }
}

#[test]
fn the_walk_reaches_the_deepest_child_in_its_client_coordinates() {
    let screen = Screen::new();
    assert_eq!(
        deepest_child(&screen, TOP, at(165.0, 170.0)),
        Some((BUTTON, ClientPoint { x: 5, y: 10 }))
    );
    assert_eq!(
        deepest_child(&screen, TOP, at(120.0, 120.0)),
        Some((TOP, ClientPoint { x: 20, y: 20 }))
    );
}

#[test]
fn a_point_off_the_addressed_window_answers_none() {
    let screen = Screen::new();
    for (x, y) in [
        (99.0, 120.0),
        (500.0, 120.0),
        (120.0, 400.0),
        (20.0, 20.0),
        (1.0e6, 120.0),
    ] {
        assert_eq!(deepest_child(&screen, TOP, at(x, y)), None, "({x}, {y})");
    }
}
