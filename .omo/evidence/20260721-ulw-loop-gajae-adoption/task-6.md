# Task 6 - gates + real-surface QA + evidence

## What was tested
- Component full gate: `npm run check && npm test` in `packages/omo-codex/plugin/components/ulw-loop`.
- Root Codex gate: `bun run test:codex` from repo root.
- Built local CLI lifecycle: `node packages/omo-codex/plugin/components/ulw-loop/dist/cli.js ulw-loop ...` inside a fresh `mktemp -d` git repo.
- Real `~/.codex/config.toml` isolation via SHA-256 before/after comparison.
- Cleanup of all temp QA repos.

## What was observed
- Component gate passed: 40 files / 412 tests.
- Root Codex gate passed: 510 tests, 0 failures.
- E2E lifecycle created a three-goal plan with `VB001`, completed G001 and auto-advanced to G002, applied a two-item `--proposals-json` batch, completed G002 and auto-advanced to G003, completed G003 as both validation-batch final and aggregate final, and emitted `batch_closed` for `VB001`.
- Fail-closed integration probe rejected a batch-final checkpoint while another member was pending with `ULW_LOOP_VALIDATION_BATCH_OPEN`.
- `~/.codex/config.toml` hash before and after was identical: `780c740e287bda48609b5c9d5ee3ee2fc20434ce1a58c36692ec07e279a161d5`.
- Cleanup receipts:
  - failed attempt temp repos removed: `tmp.lEHDskyq7B`, `tmp.gGowhcocQp`, `tmp.1f0qwLD50a`.
  - passing temp repo removed: `/var/folders/nj/hqfr8ndn5q56cqw7jqgbrck40000gn/T/tmp.zfDGIZoOCs`.

## Why it is enough
This covers the requested real built CLI surface, the component suite, the repo Codex compatibility gate, the new auto-advance path, the atomic steering batch path, validation-batch closure, aggregate completion, fail-closed rejection, and real Codex-home isolation.

## What was omitted
No live Codex app-server/TUI probe was run because this ulw-loop task changed a standalone component CLI and the plan required CLI-only local-build QA. No published package or real Codex plugin cache was used.

## Artifacts
- `task-6-component-gate.txt`
- `task-6-codex-gate.txt`
- `task-6-e2e-transcript.txt`
