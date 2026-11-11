//! Who reads each params member. The reader test enumerates every member of every params
//! schema (and the types they reference, the settings table aside) against these tables and
//! reports 0 unread members; a member without a reader, or a reader of a member the schema
//! does not have, fails it.

mod options;
mod requests;
mod verbs;

/// `(schema definition, reading stage, members)`.
pub type Reader = (&'static str, &'static str, &'static [&'static str]);

/// Every reader table.
pub const PARAM_READERS: &[&[Reader]] = &[requests::READERS, verbs::READERS, options::READERS];
