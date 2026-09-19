---
description: Execute a written omo work plan with Boulder state, an evidence ledger, worktree discipline, and parallel subagents
argument-hint: "[plan name or path] [--worktree <path>] [--make-pr]"
---

<command-instruction>
Load and follow the `ulw-execute` skill exactly.

````text
Read ${CODEBUDDY_PLUGIN_ROOT}/skills/ulw-execute/SKILL.md in full and follow every rule in it.
````

You are the orchestrator, never the implementer: this workflow delegates the
code edits and the QA to subagents and records evidence for every criterion.
The plan named in the user request is the only scope.
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>
