# Agreement source events

`record_agreement` requires `source: { sessionId, messageId }`. Both values
come from the actual extraction payload: the queue entry's `sessionId` and a
user entry's `source_message_id`. Assistant messages and `lead` context cannot
supply an event. The adapter validates this before writing JSONL and again at
finalization. New payloads carry `agreementEventVersion: 1`; a record without
source in such a payload is invalid.

Membership validation does not prove semantic attribution. The extractor can
cite a different user turn that is present in the payload. The journal prevents
that pair from counting twice, but cannot establish which turn actually supplied
a correction; that remaining attribution decision belongs to the extractor.

For each agreement, one source session/message pair counts once, regardless of
the number of tool calls, runs or batches that emit it. Distinct user turns on
the same date count separately. The date remains display metadata, not modern
event identity. Source IDs are never derived from agreement text or a tool call.

## Durable journal

The ledger holds an independent receipt journal in HTML comments of the form
`<!-- agreement-event: <sha256> -->`. A modern digest covers the version,
agreement ID, session ID and message ID, with JSON array encoding to avoid
separator ambiguity. The journal and the item mutation are one file, one
ownership-checked facts transaction and one Git commit. Receipts do not appear
in the compiled agreement prompt or the known-agreements extraction payload.

Acknowledgement resets the visible count but retains the journal. Drop and cap
eviction also retain it: an already-counted event cannot resurrect an item.
A distinct future turn can create that agreement again. Memory tools cannot
edit or remove the journal.

Malformed receipt lines are preserved as unparsed lines with diagnostics, like
other malformed ledger lines. They are not trusted as receipts and do not prevent
reading or compiling the remaining valid agreements.

### Retention limit and migration window

There is no safe hard lifetime receipt bound under the current contract:
arbitrarily old events remain replayable, including after acknowledgement, drop
or eviction, while legitimate new corrections must still be accepted. Keeping
only active-item receipts would resurrect dropped agreements. Oldest-first or
age-based pruning would count a pruned source pair again. A count alone cannot
distinguish that replay from a previously unseen source pair. A probabilistic
filter could instead suppress a legitimate correction. None is safe compaction.

Repeated extraction adds no entries once all target aliases are known. A receipt
line occupies 91 bytes including its newline. Modern events write only source
keys; they no longer create legacy-date keys. Normal steady-state growth is one
line (91 bytes) per accepted event, instead of two lines (182 bytes) for a new
target/date. Same-day events already shared the old date key. A `new` record
matching reworded text needs two source keys to survive a later drop: two lines
(182 bytes), down from four (364 bytes) for a new target/date and alias.
No source text or raw source IDs are copied into the journal.

Existing legacy receipts are retained. The first receipt-bearing write snapshots
all existing `last` dates, one seed per item. Once a journal exists, later applies
and human ack/drop preserve it without converting modern `last` dates into legacy
keys. Accepted identityless records still write their own agreement/date keys.

There is no durable migration-complete marker or artifact-retirement protocol.
An identityless record arriving after a modern event on the same date is therefore
a separate identity unless its legacy-date key was already seeded or recorded.
It can increment once independently of the modern event; its own replay cannot
increment again. Without a source identity the system cannot prove whether those
two records describe the same correction. It does not infer that from the date.
This is an explicit boundary of the source-only modern policy.

Stopping redundant date keys reduces growth but does not make source receipts
safely discardable. A fixed lifetime cap would require a separately defined
replay horizon with explicit rejection of older input, or a durable external
history index that retains the full membership set. Neither is introduced here.
Total journal size and parse work still grow with distinct accepted events, not
extraction attempts. This remains a storage/latency trade-off, not a bounded total.
Only active agreement count is bounded by the existing `maxItems` policy.

## Pre-upgrade artifacts

An identityless record is accepted only as legacy input and counts at most once
per agreement/date. Before the first journal exists, existing `last` dates seed
legacy receipts, including when that first write is an acknowledgement. Unknown historical dates cannot be recovered
from an old ledger. Distinct old corrections on one date cannot be distinguished
and collapse; distinct modern source turns never collapse.

Legacy JSONL keeps its old shape and hash. New recovery plans carry
`agreementEventVersion: 1`. When an old plan contains the agreement path, recovery
requires the original extraction records and an atomic envelope publisher.
It first verifies the original hash and pre/post ownership, renders a deduplicated
post-image from the original pre-image, restores owned old residue, publishes the
upgraded envelope, and only then applies the new post-image. A restart before
publication recognizes the old pre-state; after publication it recognizes the
new pre/post-state. Other paths in the batch retain their recorded post-images.
Already-committed old batches keep their batch receipt and are not applied again.
