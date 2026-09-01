# Task 6 evidence - engine overlay and execution boundary

## What was tested

- Builtins are installed first; ordinary omo.json fields overlay them; user-only agents are appended.
- A configured curated `execution_mode: "process"` is ignored and remains `in-process`, while a custom agent's process mode remains configurable.
- Model overrides preserve the builtin prompt and tool policy.
- `disable: true` hides a curated agent from the advertised roster.
- Team creation surfaces the exact curated-agent rejection message.

## What was observed

- `engine-agents.test.ts` completed with 7 pass and 0 fail.
- The verifier reproduction initially resolved Explore in process mode. The new pinned-mode assertion and final live record both report in-process execution.
- The full `test:senpi` suite passed the team-service integration case.

## Why it is enough

The pin is enforced after configuration overlay at the live engine boundary, so it cannot be bypassed by the config mapper while unrelated user agents retain existing behavior.

## What was omitted

No generic team eligibility registry or process-runner persona threading was added.
