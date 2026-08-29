# Issue 5970 Executor Evidence Validation

## What was tested

- Component red/green coverage for generic versus task-bound receipts, plus
  existing containment, retry, and context-pressure cases.
- Built verifier CLI, repository Codex gate, hook probe, and real isolated
  `codex app-server` wiring.

## What was observed before the fix

```text
generic receipt without deliverable: 1 failed, 25 passed
```

The hook returned empty stdout instead of the expected block decision.

## What was observed after the fix

- Component: `26 passed`; build, typecheck, and Biome clean.
- `bun run test:codex` with npm 11.12.1: clean; final Node gate `493 pass`.
- Generic CLI receipt blocked; task-bound receipt passed with empty stdout.
- Live app-server turn completed with no missing/failed hooks.
- Hook QA and harness self-check passed.
- Real `~/.codex/config.toml` hash stayed `6f9a9998e39f4f8c47e225e81801ecb2c183136a`.

## Why this evidence is enough

The red/green test proves the defect, the built CLI proves the exact changed
surface, and app-server QA proves the local plugin remains live-wired.

## What was omitted

Sandbox paths were summarized; no credentials, tokens, real Codex home, model
requests, or private task content were captured.
