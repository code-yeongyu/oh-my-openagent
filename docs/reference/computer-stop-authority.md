# Protected computer-use stop authority (#10238)

The approved revision 2 design is delivered as an ordered stack. This first
slice implements local supervisor admission, not the independently protected
durable authority. Existing launch modes still use their existing supervisors.
It does not fix marker deletion by itself or select a new O2 runtime.

## Local admission

An authority supervisor starts at generation 0, stopped. Its immediate input
state is a single sequentially consistent AtomicU64: high 63 bits are the local
request generation, low bit is stopped. A callback advances the generation and
sets stopped with one CAS, including when already stopped. MAX is absorbing.
No callback takes a mutex, allocates, persists or performs IPC.

The worker completes an already requested stop. Under the commit mutex it
snapshots the highest generation, releases held input, durably commits coverage,
and only then publishes the epoch and notifications. A later callback stays
pending for another drain. Completion never writes immediate admission; duplicate
drains neither republish nor advance the generation.

AuthorityReset is opaque, non-cloneable and bound to the supervisor allocation
and exact captured stopped word. No production constructor is exposed in this
slice. Tests construct synthetic proofs inside the safety crate only; they do
not verify a broker, authentication or installation.

Activation holds the commit mutex, requires release/durable coverage, invalidates
old epoch-bound holds and control grants, and performs one strong exact-word CAS.
A stale proof is consumed, never retargeted. If the callback wins first, the CAS
fails. If activation wins first, the next callback atomically stops it. Legacy
UserReset and test resets cannot clear an authority supervisor.

## Remaining ordered integration

1. The protected broker supplies fixed root-owned state, per-subject serialized
   transitions, exclusive engine ownership and unclean restart recovery. Its
   role-specific endpoint verifies every actual message; existing same-EUID
   agent transport is not weakened. Signed installation/update retain tombstones.
2. The hardened native controller supplies a fixed resume ceremony with fresh OS
   authentication and a credential fallback. Showing UI, a host token, a renderer
   assertion and ordinary operation approval never constitute a lift.
3. The engine validates the complete broker/subject/enrollment/instance/stop/
   revision/transaction binding before minting AuthorityReset, invalidates queued
   operation approvals, handles channel loss as a new stop, and selects this mode
   only with the coordinated new security epoch. Capture of the local word must
   precede the broker transaction; it must not be refreshed after validation.

The final integration needs real signed-process deletion/replay/restart tests
against the actual protected domain, installer failure tests and native fresh
authentication (cancel, lock/logout, stale callback, credential fallback). The
local deterministic tests do not substitute for that acceptance. Legacy
stdio/daemon/MCP/oneshot, Windows/Linux and service/remote contracts are retained.
