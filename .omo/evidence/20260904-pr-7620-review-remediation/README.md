# PR 7620 Review Remediation

## What Was Tested

- Failing-first and passing runs of
  `bun test packages/omo-opencode/src/cli/doctor/checks/deprecated-reasoning-keys.test.ts`.
- `bun test packages/omo-opencode/src/cli/doctor`.
- `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json`.
- `bun run build`.
- The built doctor CLI through `doctor --help`, an isolated mixed
  agent/category configuration, and invalid `doctor --bogus` input.
- The `opencode-qa` common self-check and isolated TUI smoke.
- Host OpenCode database session counts before and after.

## What Was Observed

- Before the implementation, both category expectations were absent. The
  focused run reported 2 pass and 2 fail.
- After the implementation, the focused run reported 4 pass and 0 fail.
- The complete doctor suite reported 175 pass and 0 fail.
- The adapter typecheck and root build exited successfully.
- The built CLI rendered doctor help and rejected `--bogus` with exit 1.
- Against the isolated mixed config, the deprecated-key check reported exactly
  two warnings:
  - `categories.deep.fallback_models`
  - `[codex].categories.deep.fallback_models`
- Agent `fallback_models` paths were absent from the deprecated-key findings.
- The OpenCode QA self-check and TUI smoke passed. The TUI rendered, accepted
  input, and tore down.
- The host OpenCode database remained at 8067 sessions.

## Why It Is Enough

The focused regression covers the reviewed context distinction at the raw
configuration traversal seam. The full doctor suite covers aggregation and
formatting. The built CLI proves the exact user-facing paths and migration hint
on the shipped surface, while the OpenCode QA checks cover harness boot and
host-state isolation.

## What Was Omitted

Other doctor failures from the intentionally empty isolated installation were
not copied because they do not exercise this check. Temporary paths were
redacted. No credentials, auth headers, environment dump, or private
personal-skill details were recorded.

## Artifacts

- `failing-first.txt`
- `focused-tests.txt`
- `doctor-suite.txt`
- `typecheck.txt`
- `build.txt`
- `manual-doctor.txt`
- `opencode-qa.txt`
