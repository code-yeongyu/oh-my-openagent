#[path = "motion.rs"]
mod motion;
use motion::{cocoa_origin, Motion};

#[test]
fn first_target_starts_at_the_target_not_the_real_pointer() {
    let mut cursor = Motion::default();
    cursor.target(125.0, 80.0, 0.0);
    let frame = cursor.frame(0.0).unwrap();
    assert_eq!((frame.x, frame.y, frame.alpha), (125.0, 80.0, 1.0));
}

#[test]
fn retargeting_glides_from_the_current_rendered_position() {
    let mut cursor = Motion::default();
    cursor.target(0.0, 0.0, 0.0);
    cursor.target(100.0, 0.0, 10.0);
    let halfway = cursor.frame(100.0).unwrap();
    assert!((halfway.x - 50.0).abs() < 1e-6);
    cursor.target(200.0, 20.0, 100.0);
    let restarted = cursor.frame(100.0).unwrap();
    assert!((restarted.x - halfway.x).abs() < 1e-6);
    let arrived = cursor.frame(280.0).unwrap();
    assert_eq!((arrived.x, arrived.y), (200.0, 20.0));
}

#[test]
fn idle_fades_without_wall_clock_sleeps() {
    let mut cursor = Motion::default();
    cursor.target(10.0, 10.0, 50.0);
    assert_eq!(cursor.frame(1050.0).unwrap().alpha, 1.0);
    assert!((cursor.frame(1140.0).unwrap().alpha - 0.5).abs() < 1e-6);
    assert_eq!(cursor.frame(1230.0).unwrap().alpha, 0.0);
}

#[test]
fn input_cannot_reveal_the_cursor_during_capture() {
    let mut cursor = Motion::default();
    cursor.target(10.0, 10.0, 0.0);
    cursor.suspend(7);
    cursor.target(20.0, 20.0, 100.0);
    assert_eq!(cursor.frame(100.0).unwrap().alpha, 0.0);
    cursor.resume(6);
    assert_eq!(cursor.frame(150.0).unwrap().alpha, 0.0);
    cursor.resume(7);
    assert_eq!(cursor.frame(280.0).unwrap().alpha, 1.0);
}

#[test]
fn capture_does_not_refresh_the_idle_deadline() {
    let mut cursor = Motion::default();
    cursor.target(10.0, 10.0, 0.0);
    cursor.suspend(7);
    cursor.resume(7);
    assert_eq!(cursor.frame(1180.0).unwrap().alpha, 0.0);
}

#[test]
fn cocoa_coordinates_preserve_negative_display_origins_and_points() {
    assert_eq!(cocoa_origin(-1400.0, -120.0, 900.0, 42.0), (-1400.0, 978.0));
    assert_eq!(cocoa_origin(320.0, 180.0, 900.0, 42.0), (320.0, 678.0));
}
