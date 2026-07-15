# Project Agent Team Mode QA

## What was tested

Command:

```text
node .omo/evidence/20260715-project-agent-team-members/run-qa.mjs
```

Focused regression command:

```text
bun test \
  packages/omo-opencode/src/features/team-mode/team-runtime/project-agent-member.test.ts \
  packages/omo-opencode/src/features/team-mode/team-runtime/prepare-team-members.test.ts \
  packages/omo-opencode/src/features/team-mode/team-runtime/create.test.ts \
  packages/omo-opencode/src/features/team-mode/team-runtime/shutdown.test.ts
```

The driver launched the real installed `opencode run` command with the local plugin source, an isolated XDG environment, a local fake OpenAI Responses provider, and a nested Git fixture containing `.opencode/agents/repository-reviewer.md`.

The driver loads `packages/omo-opencode/src/index.ts` directly, so it exercised the current uncommitted source rather than a stale build artifact. A separate build was not required by this driver.

The parent model invoked the real `team_create` tool. The inline team reused a built-in lead and launched `repository-reviewer` from `./member-worktree` as a read-only project-defined member. The child then invoked the real `team_send_message` tool before completing normally.

## What was observed

`qa-result.json` records all 18 assertions as true:

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
- The host OpenCode session count remained `3745` before and after.

The focused regression command completed with `55 pass`, `0 fail`, and `136 expect() calls` across the four affected regression files. Those tests prove the finalized review fixes:

- A required Team tool with effective `ask` is rejected without permission elevation.
- Explicit `allow` rules for all five required Team tools after a wildcard `ask` admit the project agent.
- Recursive `mkdir` return values identify the first root created by preflight and return no ownership for an already-existing path.
- On Windows, namespaced recursive-`mkdir` ownership returns are canonicalized deterministically: `\\?\C:\...` becomes an ordinary drive path and `\\?\UNC\server\share\...` becomes an ordinary UNC path.
- Namespace normalization applies only to the ownership root returned by `mkdir`; the requested member execution directory is unchanged. Non-Windows behavior is unchanged.
- Absolute `worktreePath` and optional `ownedWorktreeRoot` metadata are persisted together before inbox creation and survive later runtime patches.
- Runtime-state and inbox failures preserve pre-existing worktree sentinels while rollback removes newly owned roots.
- Normal and force deletion preserve legacy or pre-existing `worktreePath`-only directories.
- Normal and force deletion remove roots only when `ownedWorktreeRoot` proves ownership.
- Overlapping rollback ownership roots remain ancestor-deduplicated.

`opencode-run.jsonl` contains the completed `team_create` event and runtime state. It records the exact `repository-reviewer` identity, `gpt-project-agent` model with `xhigh` variant, child session ID, and prepared member worktree path.

`isolated-sessions.json` captures the parent and child rows from the throwaway OpenCode database. `provider-requests.jsonl` captures only request metadata needed to prove identity, model, prompt, task, tool visibility, and completion after the tool result.

## Why this is enough

The real run exercises the user-visible path rather than calling resolver functions directly: OpenCode loads the final project agent registry, OMO validates and preflights the member, Team Mode creates the child session, and the child reaches the provider under its exact model and prompt. The generic fallback assertion and child model observation cover accidental substitution. The structured child tool part, delivery result, and live inbox snapshot prove Team messaging executed and persisted with the correct identity and recipient. The tool list covers Team protocol capability, repository write denial, and question denial. The before and after host database counts prove isolation. The cleanup assertions prove the provider stopped and the successful sandbox no longer exists.

The focused suites complement the real run with deterministic coverage of permission precedence, Windows drive/UNC ownership normalization, and destructive cleanup edge cases that are unsafe or impractical to manufacture inside one live session. Together they prove both the normal end-to-end project-agent flow and the fail-safe ownership behavior: execution routing keeps its requested directory, uncertain or legacy paths leak safely, and only canonical roots atomically proven and durably persisted as owned are removed.

## What was omitted

No credentials, auth headers, environment dumps, raw provider request bodies, or host database contents were recorded. The fake provider uses a non-secret placeholder key. Provider evidence stores only selected booleans, model IDs, branch names, and tool names. Test output is limited to aggregate pass/fail/assertion counts.

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
