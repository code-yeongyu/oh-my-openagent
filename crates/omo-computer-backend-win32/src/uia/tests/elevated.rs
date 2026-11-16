use omo_computer_core::error::{EngineCode, Reason};

use super::fake::FakeUia;
use crate::uia::reader::UiaReader;

#[test]
fn win_elevated_target_read_refused_no_walk() {
    let mut source = FakeUia::winforms();
    source.elevated = true;
    let mut reader = UiaReader::new(source);
    let refused = reader.root_of("4660").expect_err("an elevated target is not read");
    assert_eq!(refused.code, EngineCode::AxUnsupported);
    assert_eq!(refused.reason, Some(Reason::ElevatedTarget));
    assert_eq!(reader.source().calls, vec!["elevated".to_owned()], "refused before any walk");
}
