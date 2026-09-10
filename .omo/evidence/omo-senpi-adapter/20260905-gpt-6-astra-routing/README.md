# GPT-6 Astra routing B1 evidence

## What was tested

- RED: remote `bun test packages/model-core/src/model-settings-compatibility.test.ts packages/model-core/src/model-requirements-categories.test.ts` against the RED commit, via bunshin.
- GREEN: remote `bun test packages/model-core` and `bun test packages/omo-opencode/src/agents packages/omo-opencode/src/cli/doctor packages/omo-opencode/src/tools/delegate-task packages/omo-opencode/src/hooks/no-sisyphus-gpt`, plus `bun run typecheck:packages`, via bunshin.
- Resolution proof: `resolution-proof.ts` exercises `resolveModelWithFallback` for unspecified-high, ultrabrain, and deep with OpenAI Codex Astra available and absent. Ultrabrain and deep resolve to their Sol fallback when Astra is absent; unspecified-high intentionally has no Sol rung in its exact requested chain and falls through to system default.

## What was observed

The RED run failed 5 assertions (89 passed, 5 failed, 94 tests): the new GPT-6 heuristic expectations and new Astra category expectations failed against the untouched implementation.

The first GREEN run after implementation had 988 passed and 0 failed across 101 files for the omo-opencode suites, and typecheck passed; model-core had one test expectation error caused by the later ultrabrain max-tier correction and one stale unspecified-high expectation. Those were corrected before the final GREEN run. The final GREEN rerun passed: model-core 380/380 tests, omo-opencode 988/988 tests, and typecheck all passed.

Remote clone temp directory: `/tmp/astra-b1-$(date +%Y%m%d)` on mengmotaMac. The remote script removes the directory on completion. No secrets or credential-bearing output is included.

## Why this is enough

The model-core suite covers category order, Copilot Astra selection and Sol fallback, heuristic capability compatibility, alias canonicalization, snapshot-backed supplemental capabilities, and routing invariants. The omo-opencode suites cover all requested GPT-5.6-class gates (Momus, Oracle, Hephaestus, Sisyphus/Sisyphus-Junior prompt family, frontier tool schema, no-Sisyphus hook, delegation, and doctor alias diagnostics). Package typecheck covers the touched package graph.

## Omitted

No live model/API call was made. Raw install logs, environment values, tokens, and private credentials were omitted. The OpenCode QA live harness was not run because this change is pure routing/configuration and the mandated verification surface is the remote Bun suites plus typecheck.
