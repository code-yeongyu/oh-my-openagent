# Minimal project-agent Team Mode QA

This directory contains a narrow passing real-OpenCode QA run for project-defined Team Mode members.

## What was tested

- Accepted project-file agent resolution through real isolated `opencode run --format json`.
- Rejection when a same-name later OpenCode config definition shadows the project file.
- Config-time provenance enforcement while the authoritative project agent source remains present through final registry lookup and child launch.
- Host OpenCode database isolation.

## What was observed

- All 15 assertions passed.
- The accepted OpenCode process exited 0 and `team_create` completed. It resolved member `reviewer` to final agent `repository-reviewer` with model `openai/gpt-project-agent` and variant `xhigh`.
- Exactly one child provider request and one child session were created. The request contained the project prompt marker and child task marker, exposed every required Team Mode tool, and exposed neither `write` nor `question`.
- The accepted project agent source remained present before the parent returned `team_create` and after the run, so the authoritative final OpenCode registry lookup retained its required input.
- The rejected `team_create` failed with the exact config-time provenance error after a same-name definition was introduced later through project config. It created no child provider request and no child session.
- Host OpenCode session count was 3996 before and 3996 after. Both providers stopped and both external sandboxes were removed.
- Three exploratory harness issues were corrected before the passing run: deleting the source invalidated the authoritative registry input; the root plugin SDK requires nested `query.directory`; and the project fixture needed explicit `hidden: false` plus required tool allows without a wildcard deny that would override them in final permission rules.
- The final rerun followed a test-only mock-ownership fix; the accepted and rejected runtime behavior remained unchanged.
- `qa-result.json` records git HEAD `8d80b19271feb17ff0c8a85be5eb61dfeb53a0cb`, exact `git status --short`, and SHA-256 values for all 15 intended source, test, and doc files.

## Why it is enough

The two scenarios drive the current source plugin through the real OpenCode CLI while replacing only the remote model with a local OpenAI Responses-compatible server. The accepted scenario proves final registry identity, model, variant, prompt, permissions, child request, and child session behavior. The rejected scenario proves the distinct config-time provenance guard and absence of child side effects. The unchanged host session count, stopped providers, and removed sandboxes prove isolation and cleanup.

## What was omitted or redacted

Raw provider request bodies, environment dumps, credentials, auth headers, cookies, host database rows, and raw stderr are not retained. Provider evidence contains metadata only. Temporary paths in OpenCode JSONL are replaced with stable placeholders.

## Residual risks

- This is a Linux CLI run, not a cross-platform or TUI test.
- The local provider validates request construction and tool flow, not a remote provider implementation.
- The run does not exercise remote-provider-specific behavior beyond the OpenAI Responses request contract.

## Exact commands

```bash
bash .agents/skills/opencode-qa/scripts/lib/common.sh --self-check
node --check .omo/evidence/20260716-minimal-project-agent-members/fake-provider.mjs
node --check .omo/evidence/20260716-minimal-project-agent-members/run-qa.mjs
host_db="${XDG_DATA_HOME:-$HOME/.local/share}/opencode/opencode.db"
sqlite3 -readonly "$host_db" "SELECT count(*) FROM session;"
node .omo/evidence/20260716-minimal-project-agent-members/run-qa.mjs
sqlite3 -readonly "$host_db" "SELECT count(*) FROM session;"
```

## Artifact index

- `README.md`: reviewer guide and reproduction commands.
- `run-qa.mjs`: isolated two-scenario runner and assertions.
- `fake-provider.mjs`: local OpenAI Responses SSE fake.
- `qa-result.json`: assertions, isolation counts, git state, and source manifest.
- `provider-requests.jsonl`: sanitized request metadata only.
- `opencode-run-accepted.jsonl`: structured accepted run events.
- `opencode-run-rejected.jsonl`: structured rejected run events.
