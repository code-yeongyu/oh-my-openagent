The receipt is missing or invalid; this does not establish that the task is complete.
Receipt check attempt {{ATTEMPT_COUNT}}.

Respect the task's explicit artifact write scope. For a bound task with an exact
parent-granted receiptPath, use only that file. Otherwise the verifier expects a
file under `.omo/evidence/`, but that default does not authorize writing outside
your assigned scope. If the two requirements conflict, report SCOPE_CONFLICT to
the parent; do not create an outside-scope file or broaden your own grant.

Reuse already-captured matching raw verification output with its provenance when
available. Do not rerun passing checks just to move or reformat a receipt. A new
verification command must be necessary for the assigned work and remain within
its original bounds. The receipt must contain actual output (at least 40 trimmed
characters) and be current for this execution; never fabricate or backdate it.

A status receipt, turn completion or this hook passing is not task acceptance.
Do not claim completed work while required work or checks remain. Do not create
a separate goal/controller for a delegated unit. Finish authorized bookkeeping
before the first final. The parent retains independent acceptance and accounting.
The check still applies when stop_hook_active is true.

Last assistant message:
{{LAST_ASSISTANT_MESSAGE}}

When the assigned work is actually ready for parent review, end with:
EVIDENCE_RECORDED: <path>
