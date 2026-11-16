use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use super::fake::FakeUia;
use crate::uia::client::UiaHost;

#[test]
fn one_uia_client_per_session() {
    let made = Arc::new(AtomicU32::new(0));
    let counter = Arc::clone(&made);
    let mut host = UiaHost::new(Box::new(move || {
        counter.fetch_add(1, Ordering::SeqCst);
        Ok(FakeUia::winforms())
    }));
    for _ in 0..3 {
        let reader = host.reader().expect("the client starts");
        reader.root_of("4660").expect("root");
    }
    assert_eq!(
        made.load(Ordering::SeqCst),
        1,
        "one CoCreateInstance for the whole session"
    );
    assert_eq!(host.clients_created(), 1);
    host.end_session();
    host.reader().expect("a new session starts its own client");
    assert_eq!(
        made.load(Ordering::SeqCst),
        2,
        "the next session makes its own"
    );
}
