# Project Agent Team Mode QA

## What was tested

Command:

```text
node .omo/evidence/20260715-project-agent-team-members/run-qa.mjs
```

The driver launched the real installed `opencode run` command with the local plugin source, an isolated XDG environment, a local fake OpenAI Responses provider, and a nested Git fixture containing `.opencode/agents/repository-reviewer.md`.

The parent model invoked the real `team_create` tool. The inline team reused a built-in lead and launched `repository-reviewer` from `./member-worktree` as a read-only project-defined member. The child then invoked the real `team_send_message` tool before completing normally.

## What was observed

`qa-result.json` records all assertions as true:

- `team_create` completed through the real OpenCode tool path.
- The child used `gpt-project-agent`, not the parent or generic `gpt-fake` model.
- The provider request contained `QA_PROJECT_AGENT_PROMPT_MARKER`, proving OpenCode applied the project agent prompt.
- The provider request contained the assigned child task.
- The child exposed all five required Team Mode tools.
- The child did not expose `apply_patch`, `edit`, or `write`.
- The child did not expose the `question` tool.
- `child-session-parts.json` records `team_send_message` with completed state, recipient `lead`, and a successful `deliveredTo: ["lead"]` result.
- `lead-inbox-messages.json` captures the persisted message while the run was live, with sender `reviewer`, recipient `lead`, and body `QA_TEAM_MESSAGE`.
- The child received the tool result and completed with a normal follow-up response.
- The fake provider exited before the driver completed.
- The successful-run sandbox was removed after evidence capture and assertion verification.
- The host OpenCode session count remained `3726` before and after.

`opencode-run.jsonl` contains the completed `team_create` event and runtime state. It records the exact `repository-reviewer` identity, `gpt-project-agent` model with `xhigh` variant, child session ID, and prepared member worktree path.

`isolated-sessions.json` captures the parent and child rows from the throwaway OpenCode database. `provider-requests.jsonl` captures only request metadata needed to prove identity, model, prompt, task, tool visibility, and completion after the tool result.

## Why this is enough

The run exercises the user-visible path rather than calling resolver functions directly: OpenCode loads the final project agent registry, OMO validates and preflights the member, Team Mode creates the child session, and the child reaches the provider under its exact model and prompt. The generic fallback assertion and child model observation cover accidental substitution. The structured child tool part, delivery result, and live inbox snapshot prove Team messaging executed and persisted with the correct identity and recipient. The tool list covers Team protocol capability, repository write denial, and question denial. The before and after host database counts prove isolation. The cleanup assertions prove the provider stopped and the successful sandbox no longer exists.

Unit and regression suites separately cover rejected hidden, primary, disabled, incomplete, explicit-deny, missing, lead, and canonical-collision cases, plus cleanup when preflight fails.

## What was omitted

No credentials, auth headers, environment dumps, or raw provider request bodies were recorded. The fake provider uses a non-secret placeholder key. Provider evidence stores only selected booleans, model IDs, branch names, and tool names.

On success, the driver copies reviewer-useful logs, database-derived session rows, child tool parts, and the live inbox snapshot into this evidence directory, then removes its `sandbox-<pid>` directory. On failed assertions, it records `sandboxPreservedForFailure: true` and preserves that sandbox for diagnosis. Uncaught exceptions and termination signals invoke a process-boundary handler that terminates the fake provider and saves its stdout and stderr; a failure sandbox remains available for investigation.

## Artifact index

- `qa-result.json`: assertion summary and host isolation counts.
- `opencode-run.jsonl`: structured parent turn and `team_create` output.
- `opencode-run.stderr.log`: CLI warning stream retained for reviewer visibility.
- `provider-requests.jsonl`: sanitized provider request metadata.
- `provider-stdout.log` and `provider-stderr.log`: fake provider process output.
- `isolated-sessions.json`: isolated OpenCode session rows.
- `child-session-parts.json`: structured child-session parts, including completed `team_send_message` execution.
- `lead-inbox-messages.json`: live persisted lead inbox message snapshot.
- `run-qa.mjs` and `fake-provider.mjs`: reproducible QA harness.
