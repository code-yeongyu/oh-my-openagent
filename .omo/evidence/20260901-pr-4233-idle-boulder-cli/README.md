# PR #4233 — idle Boulder state CLI evidence

## What was tested

The built OMO `run --json` CLI was driven non-interactively against a local OpenAI-compatible fake model. The project fixture contained the real idle Boulder state shape in `boulder-state.json`: `status` is `idle` and `active_plan` is `null`.

The exact redacted command is in `command.txt`. Exact captured CLI streams are in `stdout.ndjson` and `stderr.log`; `exit-code.txt` records the process result.

## What was observed

The model response (`fake response 1`) was emitted, completion reached `All tasks completed.`, the final JSON result reported `success: true`, and the process exited 0. No path-type error appeared after the response.

`isolation-receipt.txt` records the isolated XDG roots, sandbox session count, and unchanged live OpenCode session count.

## Why this is enough

This exercises the actual built non-interactive OMO CLI surface (`bun dist/cli/index.js run --json`, equivalent to the packaged `omo run --json` command) through server startup, session creation, model response streaming, Boulder-aware completion polling, JSON result emission, and process exit. The deterministic regression remains behavior-focused and separately covers the continuation decision directly.

## Omitted or redacted

Absolute machine-local paths are replaced with `<sandbox>` / `<live-opencode-db>`. The provider used only a local fake key and loopback endpoint; no real credentials or external model traffic were involved.
