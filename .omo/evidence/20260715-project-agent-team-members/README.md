# Project Agent Team Mode QA

## What was tested

Command:

```text
node .omo/evidence/20260715-project-agent-team-members/run-qa.mjs
```

The driver launched the real installed `opencode run` command with the local plugin source, an isolated XDG environment, a local fake OpenAI Responses provider, and a nested Git fixture containing `.opencode/agents/repository-reviewer.md`.

The parent model invoked the real `team_create` tool. The inline team reused a built-in lead and launched `repository-reviewer` from `./member-worktree` as a read-only project-defined member.

## What was observed

`qa-result.json` records all assertions as true:

- `team_create` completed through the real OpenCode tool path.
- The child used `gpt-project-agent`, not the parent or generic `gpt-fake` model.
- The provider request contained `QA_PROJECT_AGENT_PROMPT_MARKER`, proving OpenCode applied the project agent prompt.
- The provider request contained the assigned child task.
- The child exposed all five required Team Mode tools.
- The child did not expose the `question` tool.
- The host OpenCode session count remained `3698` before and after.

`opencode-run.jsonl` contains the completed `team_create` event and runtime state. It records the exact `repository-reviewer` identity, `gpt-project-agent` model with `xhigh` variant, child session ID, and prepared member worktree path.

`isolated-sessions.json` captures the parent and child rows from the throwaway OpenCode database. `provider-requests.jsonl` captures only request metadata needed to prove identity, model, prompt, task, and tool visibility.

## Why this is enough

The run exercises the user-visible path rather than calling resolver functions directly: OpenCode loads the final project agent registry, OMO validates and preflights the member, Team Mode creates the child session, and the child reaches the provider under its exact model and prompt. The generic fallback assertion and child model observation cover accidental substitution. The tool list covers Team protocol capability and question denial. The before and after host database counts prove isolation.

Unit and regression suites separately cover rejected hidden, primary, disabled, incomplete, explicit-deny, missing, lead, and canonical-collision cases, plus cleanup when preflight fails.

## What was omitted

No credentials, auth headers, environment dumps, or raw provider request bodies were recorded. The fake provider uses a non-secret placeholder key. Provider evidence stores only selected booleans, model IDs, branch names, and tool names.

The isolated sandbox directories and databases are cleanup-only artifacts and are not included in the committed evidence.

## Artifact index

- `qa-result.json`: assertion summary and host isolation counts.
- `opencode-run.jsonl`: structured parent turn and `team_create` output.
- `opencode-run.stderr.log`: CLI warning stream retained for reviewer visibility.
- `provider-requests.jsonl`: sanitized provider request metadata.
- `provider-stdout.log` and `provider-stderr.log`: fake provider process output.
- `isolated-sessions.json`: isolated OpenCode session rows.
- `run-qa.mjs` and `fake-provider.mjs`: reproducible QA harness.
