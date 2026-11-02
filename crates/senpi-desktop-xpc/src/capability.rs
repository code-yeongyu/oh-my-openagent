//! Fixed-width capability comparison, separate from authorization and decoding.
#[cfg(test)]
thread_local! {
    static VISITED: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

pub(crate) fn matches(left: &[u8; 32], right: &[u8; 32]) -> bool {
    left.iter().zip(right).fold(0u8, |difference, (a, b)| {
        #[cfg(test)]
        VISITED.set(VISITED.get() + 1);
        difference | (std::hint::black_box(*a) ^ std::hint::black_box(*b))
    }) == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn r2_l2_mismatch_position_cannot_shorten_comparison() {
        // given
        let expected = [42; 32];
        for mismatch in 0..32 {
            let mut supplied = expected;
            supplied[mismatch] ^= 1;
            VISITED.set(0);
            // when
            assert!(!matches(&supplied, &expected));
            // then: count actual byte visits, not noisy wall-clock timing.
            assert_eq!(VISITED.get(), 32, "short-circuited at byte {mismatch}");
        }
        VISITED.set(0);
        assert!(matches(&expected, &expected));
        assert_eq!(VISITED.get(), 32);
    }
}
