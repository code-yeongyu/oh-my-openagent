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

Symlinked ancestors above the trusted workspace/bindings roots (such as macOS
`/tmp` pointing to `/private/tmp`) are allowed. The protected root itself and
operation/binding/receipt path components inside it still cannot be symlinks.

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

## Read-only review callers

Inspect the installed role before assigning deliverables. Metis and other
read-only reviewers return native commentary and final text; never ask them to
write plans, partials, evidence, logs, checker scripts or descriptors. The parent
owns those artifacts. Request a JSON object with a nonempty string `status` and
arrays `findings` and `gaps` in commentary and final output. Required bootstrap
messages may precede the first valid commentary.

The optional parent API also exports:

- `nativeReviewEvidence(lines, agentId, turnId, phase)` captures the first valid
  commentary or exact terminal final from complete, unmodified native JSONL
  lines. Commentary uses the inclusive 8-response/10-tool early gate, counting
  cumulative observed events. Preserve tighter task bounds and independently
  check the watcher counters at first observation too; a late observation cannot
  borrow an earlier event's smaller count.
- `verifyNativeReviewEvidence(lines, proof, agentId, turnId, phase)` compares a
  saved proof with the actual native actor, current turn, assistant phase, raw
  event bytes/text and hashes. A final additionally requires exact matching
  latest `task_complete` text and no later assistant message/start/abort.
- `nativeToolOutputEvidence(lines, agentId, turnId, callId)` pairs one actual
  `function_call` with `function_call_output`, or `custom_tool_call` with
  `custom_tool_call_output`, using the same native call ID and turn. It preserves
  raw event bytes, hashes and the complete output value; it does not infer that
  the command was read-only or that its output satisfies the task. The parent
  must inspect the actual tool operation and independently check the source/read
  result, allowed scope, modality and permissions.

These are observations, not admission, a watchdog, a scheduler or acceptance.
The parent must read real native transcript bytes; do not reconstruct events,
forge actor/turn bindings or replace a transcript with parsed/pretty text.
Malformed or unsupported structured output fails closed. Preserve mandatory
citation metadata: never strip it to force JSON parsing to succeed; report the
incompatibility instead. Keep all original failed proofs and receipts.

### Normal CLI and task-local ownership

Run Node-based preparation, capture, watcher and checker scripts through the
normal Node CLI. `functions.exec` can invoke `exec_command`, but it and restricted
`node_repl` kernels are not the Node CLI and may lack `process`. Resolve the actual
executable there and pass its absolute path as data/argv; do not evaluate
`process.execPath` or import CLI entrypoints inside the restricted kernel.
The import-only parent API is separate from the CLI entrypoint.

Before dispatch, copy `native-review-capture.mjs`, `native-review-evidence.mjs`,
`parent-evidence.mjs` and `entry-guard.mjs` from the resolved plugin's `scripts/`
into the task-owned evidence directory. Copy the external adapter's watcher
there too, pin all approved hashes and bind the copies as task inputs. Run the
local watcher, and use the same local helper in the independent parent checker.
Shared installed scripts are templates, not task output directories. Register
unique raw/meta/final/checker output paths before the worker starts.

The copied CLI writes proof JSON to stdout without editing the transcript or
publishing acceptance:

```text
node TASK/native-review-capture.mjs capture TRANSCRIPT ACTOR TURN commentary
node TASK/native-review-capture.mjs capture TRANSCRIPT ACTOR TURN final_answer
node TASK/native-review-capture.mjs verify TRANSCRIPT ACTOR TURN final_answer PROOF_JSON
node TASK/native-review-capture.mjs tool-output TRANSCRIPT ACTOR TURN CALL_ID
```

Replace all placeholders and use the verified absolute Node executable in a
collector descriptor's explicit argv. The CLI requires complete UTF-8 JSONL.
Keep native stdout/proof files separate from the descriptor and from parsed
reports. A setup fixture runner expecting `READ_OK` and a marker is not an
ordinary review checker: critique acceptance must check the assigned source and
task-specific result while keeping the native provenance gates.

Test the **complete** capture-to-checker CLI/argv/artifact pipeline offline before
spending a native setup attempt, using retained copies and positive/rejection
cases. Include both native output families, actor/turn/phase/call-ID mismatches,
altered proofs/text/hashes and event/observation budget failures. A syntax check
or isolated parser test is insufficient. Bind the exact tested checker bytes.
Require successful preparation and valid descriptor/inputs before dependent
ledger initialization or collection. Offline replay is not new native proof and
does not authorize retrying or accepting a historical failed run.

### Accounting and acceptance remain separate

Keep genuine native admission/attachment, current-chat runtime/tool/route gates,
the external cumulative response/tool/time watchdog, actual served requests,
independent checking, normal collector publication and actor/goal/continuation
settlement. Capture alone never accepts a task or approves a critique's findings.
The executor stop hook does not grant a read-only role file-write permission.

A normally completed child with a failed parent capture/checker is rejected,
not interrupted. Retain its actual sends with `accepted=false` and
`interrupted=false`; reserve interrupted accounting for genuinely interrupted
requests. Preserve a misclassified historical receipt with an explicit caveat
instead of rewriting it. Distinguish verified post-final counts, in-flight
checkpoints and estimates. Final replies and text-only handoffs still consume
response allowance. Unused tool allowance cannot reopen an exhausted response
budget or expired deadline; repair does not authorize replenishment, a new worker
or retroactive acceptance. Another chat still needs its own applicable gates.
