//! The live server's element table (review H2, M3): one id per element across reads.

use crate::ax::table::ElementTable;

fn same(a: &(u64, &str), b: &(u64, &str)) -> bool {
    a.0 == b.0
}

#[test]
fn same_element_keeps_one_id_across_reads() {
    let mut table = ElementTable::default();
    // Every AX read hands out a fresh reference ("a", "b") to the same element (key 7).
    let first = table.intern((7, "a"), 70, same);
    let again = table.intern((7, "b"), 70, same);
    assert_eq!(
        first, again,
        "a banner keeps its id, so its arrival time is kept"
    );
    assert_eq!(table.len(), 1, "one entry per element, not per read");

    // A different element on the same hash bucket is still its own entry.
    let other = table.intern((8, "c"), 70, same);
    assert_ne!(other, first);
    assert_eq!(table.len(), 2);

    assert!(
        table.remove(first).is_some(),
        "a destroyed element is released"
    );
    assert!(table.get(first).is_none());
    let reborn = table.intern((7, "d"), 70, same);
    assert_ne!(reborn, first, "a removed id is never reused");
    assert_eq!(table.len(), 2);
}
