pub(super) const fn restore_target(
    previous: usize,
    target: usize,
    current: usize,
    current_owner: usize,
) -> Option<usize> {
    if current == previous {
        None
    } else if current == target || current_owner == target {
        Some(previous)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::restore_target;

    #[test]
    fn preserves_a_new_unrelated_foreground_window() {
        assert_eq!(restore_target(10, 20, 30, 30), None);
    }

    #[test]
    fn restores_after_the_target_or_its_owned_modal_remains_frontmost() {
        assert_eq!(restore_target(10, 20, 20, 20), Some(10));
        assert_eq!(restore_target(10, 20, 21, 20), Some(10));
    }
}
