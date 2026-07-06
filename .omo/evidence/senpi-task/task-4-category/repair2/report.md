# Todo 4 Category Repair2 Evidence

## What Was Tested

- RED: `bun test packages/senpi-task/src/category`
  - Scenario: added malformed truthy `find()` return probes and non-array `getAvailable()` probes before production edits.
  - Observable: failed with `resolved` for malformed `find()` and `TypeError` for `getAvailable: () => null`.
  - Artifact: `red-category-boundary-tests.log`; exit: `red-category-boundary-tests.exit`.

- GREEN: `bun test packages/senpi-task/src/category`
  - Scenario: category resolver unit suite, including malformed `{}`, non-string provider/id, private-field `find()` object, and `null`/object/string `getAvailable()`.
  - Observable: 14 pass, 0 fail.
  - Artifact: `01-category-test-final3.log`; exit: `01-category-test-final3.exit`.

- GREEN: `bun test packages/senpi-task --bail`
  - Scenario: full senpi-task package tests after boundary parser repair.
  - Observable: 43 pass, 0 fail.
  - Artifact: `02-senpi-task-bail-final2.log`; exit: `02-senpi-task-bail-final2.exit`.

- GREEN: `bun run typecheck`
  - Scenario: repo TypeScript typecheck, including `packages/senpi-task/tsconfig.json`.
  - Observable: command exited 0.
  - Artifact: `03-typecheck-final2.log`; exit: `03-typecheck-final2.exit`.

- GREEN: `bun run packages/senpi-task/scripts/manual-category-qa.ts`
  - Scenario: manual data-surface probe for happy/disabled/unavailable/fallback/system-default/malformed-entry/prototype plus new malformed `find()` and non-array `getAvailable()` cases.
  - Observable: `malformedFind.kind` and `nonArrayAvailable.kind` are `model_unavailable`; `malformedFind` output does not contain `hidden`.
  - Artifact: `04-manual-category-qa-final2.log`; exit: `04-manual-category-qa-final2.exit`.

- GREEN: static guards
  - `rg` import/export guard for `omo-opencode`: `05-no-omo-opencode-import-guard-final3.log`.
  - delegate-core handoff plus no local model-order scan: `06-no-local-model-order-guard-final3.log`.
  - no-excuse TypeScript guard: `07-no-excuse-ts-guard-final2.log`.
  - pure LOC check: `08-loc-check-final3.log`.
  - cleanup/status and `git diff --check`: `09-cleanup-status-final3.log`.
  - scoped escape-hatch scan: `11-escape-hatch-scan.log`; exit: `11-escape-hatch-scan.exit`.

## What Was Observed

- `resolveCategory` now parses the registry availability container before filtering entries. Non-array availability returns typed `model_unavailable` with `availableModels: []`.
- `resolveCategory` now parses `find()` output before child spec creation. Malformed truthy objects do not produce `kind: "resolved"`.
- Sensitive top-level model fields (`apiKey`, `authorization`, `headers`, `privateToken`, `secret`, `token`) are rejected at the registry boundary; the private-field probe returns sanitized `model_unavailable`.
- No scoped runtime imports/exports from `packages/omo-opencode` or `@oh-my-opencode/omo-opencode` were found.
- The resolver still delegates model ordering to `resolveModelForDelegateTask`; no local 7-step/model-order implementation patterns were found.

## Why It Is Enough

The RED artifact reproduces both review2 blockers against the category resolver before production edits. The final unit suite covers all malformed registry shapes requested in the repair assignment, and the manual QA script drives the same data boundary through the package's executable QA surface. Typecheck, package tests, no-excuse guard, import boundary guard, model-order guard, LOC, and cleanup/status cover the assignment's regression and process constraints.

## What Was Omitted

No OpenCode, Codex, Senpi UI, tmux, browser, server, network, or real user config surface was spawned. The touched package is `senpi-task` category logic plus its manual QA script, so the observable surface is in-memory resolver behavior and the executable manual category QA script. No secrets, auth headers, env dumps, or real `~/.senpi` / `~/.codex` files were read or copied.

## Residual Risk

The sensitive-field parser is intentionally small and top-level. It rejects the reviewed private-field class without trying to classify every possible future Senpi model metadata field.
