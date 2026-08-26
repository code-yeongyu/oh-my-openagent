# Issue 6922 QA evidence

## What was tested

- `bun test packages/omo-senpi/src/components/task/status-row-format.test.ts packages/omo-senpi/src/components/task/status-ui.test.ts packages/omo-senpi/src/components/task/status-ui-background.test.ts --bail`
  - Proves the regression was RED before production changes and GREEN afterward.
  - Covers canonical completed resident team members, ordinary completed background tasks, stale/non-resident team records, active-first ordering, the five-row cap, widget retention, and settled spinner-free rendering.
- `bun test packages/omo-senpi/src/components/task`
  - Exercises the complete neighbouring task-component suite.
- `bun run --cwd packages/omo-senpi typecheck`
  - Checks the changed adapter package under strict TypeScript.
- `env -u OMO_CODING_AGENT_DIR -u SENPI_CODING_AGENT_DIR -u OMO_NATIVE bunx bun@1.3.14 run test:senpi`
  - Runs the full repository Senpi gate using CI's pinned Bun version and without inheriting the caller's live OmO Native agent-directory variables.
- `SENPI_BIN="$(command -v senpi)" node packages/omo-senpi/scripts/qa/drive.mjs`
  - Drives the built extension through a real isolated Senpi process with the repository mock provider.

## What was observed

- RED failed at `expect(rows[4]).toContain("settled alpha")` because the old selector returned only four active rows.
- Targeted GREEN: 32 passed, 0 failed.
- Neighbouring task suite: 370 passed, 0 failed.
- Package typecheck: passed with no diagnostics.
- Full clean-env package gate: 1911 passed, 1 Windows-only skip, 0 failed.
- Live Senpi adapter QA: `PASS`; ultrawork injection and comment-checker both passed, and the real Senpi agent directory stayed untouched.

Artifacts: `red.txt`, `targeted-tests.txt`, `task-suite-summary.txt`, `package-gate-summary.txt`, and `live-qa.json`.

## Why this is enough

The focused tests exercise the exact widget selection and rendering boundaries changed by the patch. The neighbouring suite protects task-component integration, the package gate covers the full built adapter and generated extension, and the isolated live run proves that the rebuilt extension loads and executes without touching the developer's real Senpi state.

## What was omitted

Full package and neighbouring-suite logs remain in temporary local files because they are large and contain no additional issue-specific evidence; their exact final counts are preserved here. No credentials, model responses, auth headers, or private configuration were copied into this evidence directory. All QA sandboxes and spawned processes were cleaned up by the drivers or explicitly removed after failed exploratory runs.
