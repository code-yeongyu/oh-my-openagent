// Appended to model-facing DAG completion payloads only. A DAG node's own summary is unverified
// self-report, so the orchestrating parent is told to re-derive the node's scope and prove every
// deliverable itself before treating the node as done.
export const DAG_VERIFICATION_DIRECTIVE = `DAG SUBAGENT COMPLETION - TREAT AS FALSE UNTIL YOU PROVE IT.
This completion arrived from a DAG subagent. Assume it overstated or fabricated its work. Its summary is a CLAIM, not evidence.
Before relying on this result you MUST, in order:
1. RECONSTRUCT the node's full work scope from its prompt: every deliverable, file, and check it owed.
2. READ the actual artifacts yourself - open every file it claims it changed, run the commands it claims pass. Transcripts and summaries prove NOTHING.
3. VERIFY each deliverable against that scope with your own eyes and your own tool calls - in BOTH directions: nothing owed is missing, and nothing beyond the scope was done. Over-engineering, drive-by refactors, and edits outside the prompt's scope are defects, not bonus work.
If ANY deliverable is missing, partial, or unproven, or the node drifted out of scope: send precise corrective instructions to THIS node (dag action "send" with this run_id and node_id; "retry" when it cannot be continued) and demand the fix WITH evidence: complete what is missing, revert what fell outside the scope. Loop until your own verification passes.
Work is done ONLY when you have verified it yourself.`

// The GPT-6 Astra parent gets a spot-check, not a replay: its prior is already to verify broadly,
// and "run the commands it claims pass" made it rerun every green suite per node. The node's own
// VERIFY output is the evidence it reads; a rerun needs a reason.
export const ASTRA_DAG_VERIFICATION_DIRECTIVE = `DAG SUBAGENT COMPLETION - A CLAIM UNTIL ITS EVIDENCE CHECKS OUT.
Read the node's VERIFY output against the scope its prompt set, in both directions: every owed deliverable present, nothing done beyond the scope. Rerun a check only when that output is missing, failing, or contradicts the scope.
If a deliverable is missing, partial, unproven, or out of scope, send corrective instructions to THIS node (workflow action "send" with this run_id and node_id; "retry" when it cannot be continued) and require the fix with its VERIFY output.`

export const ASTRA_DAG_RUN_VERIFICATION_DIRECTIVE = `DAG RUN COMPLETION.
The run's verification node owns the combined checks: read its output against the run's requirements and the node summaries above. A run without one gets a single pass of the checks its requirements name, run once. Rerun a check only when its output is missing, failing, or contradicts a requirement; correct incomplete or out-of-scope work through the affected node. Report unresolved failures or blockers.`
