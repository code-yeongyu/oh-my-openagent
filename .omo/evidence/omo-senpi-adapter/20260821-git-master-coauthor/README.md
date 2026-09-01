# QA Evidence: omo-senpi git_master co-author settings toggle (2026-08-21)

Change under test: new `git_master` omo.json section (omo-config-core) + omo-senpi
`git-master` attribution component (read-channel `tool_result` hook) + `createTaskSkillLoader`
attribution wrapper (load_skills channel) + docs + regenerated `assets/omo.schema.json`.

## What was tested
- `git-master-attribution/verdict.json`: NEW lane driver `packages/omo-senpi/scripts/qa/git-master-attribution-e2e.mjs`
  drives the REAL `senpi` binary (2026.8.20-2) with the built plugin in an isolated sandbox, twice:
  1. enabled scenario — project `.omo/omo.json` without a `git_master` section (defaults ON); the shared
     mock provider scripts a `read` tool call on the sandboxed `git-master/SKILL.md`.
  2. disabled scenario — `.omo/omo.json` with `{"git_master":{"commit_footer":false,"include_co_authored_by":false}}`.
- `drive-live-tail.log`: stock `drive.mjs` live run (adapter wiring regression).
- `task-load-skills/verdict.json`: stock `task-load-skills-e2e.mjs` (skill delivery through the new
  loader wrapper).
- `load-skills-resolver-capture.txt`: real `createTaskSkillLoader` resolver output for three
  settings scenarios (default_on / coauthor_off / all_off).

## What was observed
- Enabled: the `read` tool_execution_end result carries the appended directive with
  `Co-authored-by: sisyphus-dev-ai <sisyphus-dev-ai@users.noreply.github.com>` and the
  "Ultraworked with" footer; disabled: skill body present, no trailer, no footer. All 9 checks PASS.
- `drive.mjs` live: PASS (`ultraworkInjected: true`, `commentChecker: PASS`, `realSenpiUntouched: true`).
- `task-load-skills-e2e`: PASS with a clean child env. A first run FAILED because this QA ran inside an
  omo session whose `OMO_CODING_AGENT_DIR=~/.omo/agent` leaked through `...process.env` and outranked
  the sandbox `SENPI_CODING_AGENT_DIR` in `resolveAgentHome` — an environmental leak, not a code
  regression (identical failure without the diff). The new lane driver scrubs
  `OMO_CODING_AGENT_DIR`/`PI_CODING_AGENT_DIR` in-driver.
- Resolver capture: default_on embeds trailer+footer inside the `<skill name="git-master">` block;
  coauthor_off drops only the trailer; all_off leaves the block untouched.
- Isolation: `realAgentDirsUntouched: true` / `changedRealDirs: []` on every run; sandbox agent dirs were
  temp dirs under `omo-senpi-qa-*` and each driver removed its sandbox (`rmSync` in `finally`).

## Why it is enough
The live lane proves the user-visible behavior end to end on the real harness for both toggle states of
the read channel; the stock drivers prove no regression to adapter wiring and load_skills delivery; the
resolver capture pins the load_skills channel content per settings matrix. Unit gates:
`bun test packages/omo-config-core` 184 pass, component + loader suites 11 pass, tsgo clean.

## What was omitted / known noise
- `bun run test:senpi` reports 13 pre-existing failures (init-deep-advisor ui.select flow,
  session-start onboarding ordering, product-identity path) that reproduce IDENTICALLY on clean
  origin/dev c7935607e on this host (mengmotaHost) — unrelated to this change, not fixed here.
- Raw stdout logs kept verbatim; they contain no credentials (mock provider, sandboxed homes).
