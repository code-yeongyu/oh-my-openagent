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
