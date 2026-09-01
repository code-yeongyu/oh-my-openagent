# QA Evidence — omo-senpi ultrawork duplicate-injection guards

Change: packages/omo-senpi ultrawork component input-transform guards
(`ulw(?!-)` trigger, matched-pair `<ultrawork-mode>`...`</ultrawork-mode>`
reinjection guard, senpi-parse-aware `/skill:` handling) plus a sync-skills
description rewrite for the shipped ultrawork SKILL.md.

## What was tested

1. Unit (RED -> GREEN): 4 new cases added FIRST to
   `packages/omo-senpi/src/components/ultrawork/ultrawork.test.ts` and captured
   failing against the old component (transform instead of continue; prepend
   instead of append; Codex-pointer description). A post-review hardening pass
   added 3 more cases (see below). Component suite: 16/16 pass.
2. Package gate: `bun run test:senpi` (senpi plugin staging + tsgo + bun test
   packages/omo-senpi) -> 233 pass / 0 fail. See `test-summary.txt`.
3. Repo gates: root `bun run typecheck` exit 0; root `bun test` -> 11749 pass /
   0 fail / 3 skip (CI parity). See `test-summary.txt`.
4. Live senpi harness: `driver.mjs` (this directory) drives the REAL senpi
   binary with the worktree-built plugin in an isolated
   `SENPI_CODING_AGENT_DIR` mktemp sandbox and the bundled mock provider
   (zero tokens, no real credentials). Six scenarios assert what the recorded
   session actually contains. Output: `driver-output.json`.

### Post-review hardening (adversarial review findings)

- `/skill:ultrawork <args>` previously double-injected: senpi expansion inlines
  the full SKILL.md (whose body IS the directive) and the hook appended a
  second copy. Bare `/skill:ultrawork` was worse: senpi parses the skill name
  up to the FIRST SPACE only, so the appended `\n<ultrawork-mode>...` corrupted
  the name and expansion silently failed. The hook now mirrors senpi's exact
  name/args parse: `/skill:ultrawork` passes through untouched, a trigger that
  appears only in the skill NAME does not arm, and only trigger-carrying args
  get the appended directive.
- The reinjection guard required only the OPEN tag, so a prompt merely
  mentioning `<ultrawork-mode>` in a question silently disarmed a legitimate
  trigger. It now requires the matched open+close tag pair.

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
- `/skill:ultrawork fix this login bug` -> session contains the expanded
  `<skill name="ultrawork">` block with exactly ONE `<ultrawork-mode>` open tag
  (no appended duplicate; the sentinel line occurs twice WITHIN one directive
  body, so blocks are counted by open tag).
- `Explain what <ultrawork-mode> means, then ulw this fix` -> directive body
  present (a lone open-tag mention no longer disarms a legitimate trigger).
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
real senpi session for all fixed defects plus the regression path.

## What was omitted

- Raw senpi session JSONLs from the sandboxes (deleted with the sandboxes; the
  assertions in `driver-output.json` summarize them). No tokens, credentials,
  or environment dumps are recorded; the mock provider serves scripted text.
