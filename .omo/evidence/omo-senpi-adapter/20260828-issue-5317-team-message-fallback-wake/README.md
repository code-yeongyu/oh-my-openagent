# Issue 5317: Senpi adapter QA

## What was tested

- `node packages/omo-senpi/scripts/qa/drive.mjs --self-test`
- `node packages/omo-senpi/scripts/qa/drive.mjs`
- `bun run test:senpi`
- CI-Bun 1.4.0 Senpi extension regeneration and freshness check

Changed shipped paths:

- `packages/omo-senpi/plugin/extensions/omo-task.js`
- `packages/omo-senpi/plugin/extensions/omo-member.js`

## What was observed

- Driver self-test: `SELF-TEST OK`
- Real Senpi driver: `PASS`
- Ultrawork injection: observed
- Comment checker: `PASS`
- Real Senpi agent directory: untouched
- Caller-provided `SENPI_CODING_AGENT_DIR`: unset
- Sandbox agent directory:
  `/private/var/folders/13/yyrkyfts6qsg303mcwpwzq200000gn/T/omo-senpi-qa-DehvME/agent`
- Sandbox removed after capture; matching child processes: 0
- Package gate: 2417 pass, 1 Windows-only process-driver skip, 0 fail
- Evidence resolver tests: 10 pass, 0 fail

## Why it is enough

The self-test validates the isolation harness, while the live driver loads the
regenerated plugin through the real Senpi binary and observes shipped adapter
behavior. The package gate and CI-Bun freshness check cover the generated
artifacts and adapter regressions.

## What was omitted

- No credentials, tokens, environment dumps, or provider traffic were copied.
- The Windows-only process-driver case was skipped by its platform guard on
  this macOS workstation; CI covers platform jobs.
