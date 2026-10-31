# Executor evidence receipts

Unbound workers keep the default `.omo/evidence/` receipt directory. This default
does not grant permission to write outside a task's explicit artifact scope.
If those requirements conflict, the worker reports the conflict to its parent.
Existing verification output should be reused with provenance rather than rerun
solely to relocate an evidence receipt.

## Optional parent attachment integration

A parent operations adapter may snapshot an exact `receiptPath` at native spawn
attachment. The verifier reads the binding from
`~/.omo/operations/bindings/<agent_id>.json`. This component does not create
bindings, dispatch workers, or provide an operations scheduler.

The binding contains `file` (the absolute run manifest path), `taskId`, and a
`receiptGrant` snapshot of `receiptPath`, `role`, `sourceFingerprint`, and
`spawnCallId`. The schema-version-1 manifest must be the workspace's
`.omo/operations/<runId>/run.json`, identify the same workspace, and contain a
running task with the matching task ID, agent ID, role, and grant fields. Its
`hookReceipts` must include the child's native `PostToolUse` attachment.

Only that exact receipt under the same operation is accepted. Siblings,
traversal, the run manifest itself, symlinked path components, changed grants,
and malformed bindings are rejected. Existing file, content and freshness checks
still apply. Missing bindings and legacy bindings without a grant retain the
default behavior. This is same-user filesystem integration, not a cryptographic
security boundary: the parent adapter must preserve its admission evidence and
restrict worker writes to the authorized artifacts.

## Completion boundary

The hook validates a receipt, not task acceptance or actor settlement. A worker
finishes authorized bookkeeping before its first final and leaves goal ownership
to its parent. Parent collectors must validate the latest turn rather than an
earlier final or `task_complete`; a later start or abort invalidates the earlier
completion candidate. Continuations retain cumulative budgets and failure
accounting. An idle/completed actor, no active goal, and no pending continuation
are separate settlement observations. Quiet time alone proves none of them.
