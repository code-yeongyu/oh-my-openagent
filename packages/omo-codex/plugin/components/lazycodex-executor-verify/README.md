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

Return control after each bounded native wait and preserve its structured result.
For V1, an empty status map is a polling timeout only when `timed_out=true`;
missing/malformed status or a failed terminal actor must not silently loop until
the watchdog expires. V2 has a different mailbox schema: adapt that schema
explicitly instead of feeding it to a V1 decoder. Keep an independent watchdog
and cumulative response/tool/time limits; a deadline never silently renews.

## Optional parent collector helpers

External adapters can import the shipped `scripts/parent-evidence.mjs` from their
resolved plugin installation. This dependency-free module is an explicit adapter
API, not a scheduler, hook, provider integration or proof producer:

- `nativeWaitState(result, agentId)` decodes an actual V1 native wait result.
- `completionState(events, actor)` checks latest-turn lifecycle plus independently
  read actor status, `activeGoal=false` and `pendingContinuation=false`. The caller
  must bind fresh observations to the same child; it must not infer them from
  transcript quietness or manufacture them from saved configuration.
- `resolveCheckDescriptor(check, workspace)` preserves the explicit executable
  argv and resolves an owned workspace-relative output. Pass a canonical trusted
  workspace; absolute/escaping artifacts and existing symlink components fail.
- `publishReceipt(output, result, commit)` exclusively creates an unaccepted
  pending receipt, awaits the caller's verified ledger commit, then atomically
  publishes acceptance. A failed commit publishes rejected/unaccepted evidence
  with the original accounting. Existing output is never overwritten. A crash
  after commit but before publication leaves a pending receipt, not false
  acceptance. This is same-user filesystem coordination, not protection from a
  hostile concurrent writer or a cross-file atomic transaction.

For example, a parent collector imports these helpers and calls
`await publishReceipt(output, verifiedResult, () => commitVerifiedTask(verifiedResult))`.
`commitVerifiedTask` is supplied by the external ledger: it must validate native
admission/attachment, child/role identity, actual served requests, current inputs,
dependencies, independent checks and remaining cumulative budgets before commit.
The helper does not replace any of those gates. Require successful process exit,
an accepted published receipt **and** the matching committed ledger task; a
pending or rejected file is not acceptance. Preserve spent failures and sends.

When workers prepare a check, include exact owned paths and this JSON contract
in their self-contained prompt:

```json
{"command":["python3","/absolute/check.py"],"artifact":".omo/operations/example/check-result.json"}
```

Replace the example paths. `check.json` holds this descriptor, never the check's
stdout. Commands are a nonempty JSON string array: execute the first element
with the remaining elements as argv, `shell:false`, from the bound workspace.
The checker exits nonzero on failed assertions. Store stdout/stderr separately
(for example `check-result.json` or a unique derivative of its artifact path),
retain the original descriptor bytes and independently verify saved output.
Never infer argv from a shell string or relax validation to accept an output
document. Correcting metadata does not retroaccept a failure or approve source.
