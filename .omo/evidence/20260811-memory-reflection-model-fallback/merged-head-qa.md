# Current-head QA receipts (76b427a1e)

Head under test: `76b427a1e1ff0915e242243e0df6a7e25a9e0cd4` (merge of `origin/dev` into `feat/memory-v2-active-learning`).

## What was tested
- Full package suites, both typechecks, and the committed-bundle freshness verifier that CI itself runs
  (`node packages/omo-senpi/plugin/scripts/build-extension.mjs --check`), after merging `dev`.
- Real Senpi surface, model fallback: `SENPI_BIN=... bun packages/omo-senpi/scripts/qa/memory-model-fallback-e2e.mjs`.
- Real Senpi surface, skill startup: `SENPI_BIN=... bun packages/omo-senpi/scripts/qa/memory-skill-startup-e2e.mjs`.

## What was observed
```
481 pass
 0 fail
Ran 481 tests across 60 files. [75.38s]
 1282 pass
 0 fail
Ran 1282 tests across 203 files. [101.97s]
```
- Bundle freshness verifier: build is current (exit 0), so the committed artifacts match their sources.
- Model fallback E2E: `{"result": "PASS", "attempts": ["extension-only/primary", "omo-mock/mock-1"], "outcome": "merged", "model": "omo-mock/mock-1", "isolationRoot": "/var/folders/h6/w548ypzn1k78_xqndn63y7xc0000gn/T/omo-senpi-qa-0vRyi5"}`
  The primary attempt that the detached child cannot reach is abandoned and the run completes on the
  reachable fallback, ending `merged`.
- Skill startup E2E: `{"result": "PASS", "exit": 0, "missingSkillPathWarning": false, "frontendCollision": false, "skillsPathExists": false, "isolationRoot": "/var/folders/h6/w548ypzn1k78_xqndn63y7xc0000gn/T/omo-senpi-qa-jEhLVI"}`
  No missing-skill-path warning and no `frontend` skill collision on a clean startup.
- Isolation: both runs used their own `mktemp` roots, reported above; the host memory repo digest was
  identical before and after (`HOST-MEMORY-UNCHANGED`), so `~/.omo/memory` was never read or written.
- Both isolation roots were removed after the receipts were captured.

## Why it is enough
The suites cover the behavior changes at unit level, the freshness verifier covers the generated
artifacts that ship, and the two live drivers exercise the two user-visible lifecycle paths this branch
changed on the real Senpi surface rather than through mocks. Terminalization and facts recovery each
additionally carry adversarial reviewer verdicts recorded in the draft.

## What was omitted
No provider credentials, auth headers, tokens, or environment dumps are included. The live drivers run
against a local mock provider, so no external API call is made; only the JSON receipts above are kept.
