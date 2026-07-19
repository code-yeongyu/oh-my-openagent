# QA Evidence — omo-senpi ultrawork duplicate-injection guards

Change: packages/omo-senpi ultrawork component input-transform guards
(`ulw(?!-)` trigger, `<ultrawork-mode>` reinjection guard, `/skill:` append)
plus a sync-skills description rewrite for the shipped ultrawork SKILL.md.

## What was tested

1. Unit (RED -> GREEN): 4 new cases added FIRST to
   `packages/omo-senpi/src/components/ultrawork/ultrawork.test.ts` and captured
   failing against the old component (transform instead of continue; prepend
   instead of append; Codex-pointer description). Component suite: 13/13 pass.
2. Package gate: `bun run test:senpi` (senpi plugin staging + tsgo + bun test
   packages/omo-senpi) -> 230 pass / 0 fail. See `test-summary.txt`.
3. Repo gates: root `bun run typecheck` exit 0; root `bun test` -> 11749 pass /
   0 fail / 3 skip (CI parity). See `test-summary.txt`.
4. Live senpi harness: `driver.mjs` (this directory) drives the REAL senpi
   binary (2026.7.17-5) with the worktree-built plugin in an isolated
   `SENPI_CODING_AGENT_DIR` mktemp sandbox and the bundled mock provider
   (zero tokens, no real credentials). Four scenarios assert what the recorded
   session actually contains. Output: `driver-output.json`.

## What was observed

- `ulw please respond` -> directive body present (trigger regression guard).
- `ulw-plan please respond` -> NO directive (skill-name misfire fixed).
- prompt already carrying `<ultrawork-mode>` -> NO directive body (no
  reinjection; previously the pasted block got a second full copy).
- `/skill:frontend ulw ...` -> session contains the expanded
  `<skill name="frontend">` block AND the directive (native expansion preserved
  because the directive is appended, not prepended; the raw `/skill:` string is
  gone because senpi replaced it with the expansion, proving `startsWith`
  survived the transform).
- Isolation: `realSenpiUntouched: true` over the real agent dir's
  `settings.json` + `trust.json` digests. The full-directory digest used by
  `drive.mjs` is not applicable here because this QA ran from within a live
  senpi session that continuously appends to `~/.senpi/agent/sessions` and
  telemetry state; config files are the surface a sandbox leak would corrupt.

## Why it is enough

The component is a pure input transform on the senpi `input` extension event.
Unit tests pin the full decision table (trigger forms, guards, source
recursion, disabled flag, malformed payloads), the package/repo gates prove no
regression elsewhere, and the live driver proves the end-to-end behavior of the
BUILT plugin (`plugin/extensions/omo.js` + generated `plugin/skills`) inside a
real senpi session for all three fixed defects plus the regression path.

## What was omitted

- Raw senpi session JSONLs from the sandboxes (deleted with the sandboxes; the
  assertions in `driver-output.json` summarize them). No tokens, credentials,
  or environment dumps are recorded; the mock provider serves scripted text.
