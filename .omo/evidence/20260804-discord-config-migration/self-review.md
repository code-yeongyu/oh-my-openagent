# Self Review

Reviewer gate: not triggered. This is HEAVY work, but no user-requested `ulw-plan` plan artifact exists for this change, so the workflow requires a recorded self-review rather than `momus`/`metis`.

## Criterion reconciliation

1. Ownership/status: PASS in `triage.md`.
2. Failing-first proof: PASS in `red.md`, including the self-review adjacent-harness RED.
3. Targeted GREEN: PASS in `green.md`.
4. Migration, startup, validator, doctor, and disabled-provider regression suite: PASS, 37 tests and 116 assertions before the final doctor-only correction; the affected doctor file then passed 2 tests and 4 assertions.
5. Strict type safety: PASS, full `bun run typecheck` after the final source change.
6. Build/schema: PASS, `bun run build:schema` and final `bun run build`.
7. Real surface: PASS in `qa.md`.
8. Cleanup: PASS for all QA sandboxes and browser resources.

## Architectural self-review

1. Root cause, not symptom: yes. The plugin schema/config-chain/runtime view now agrees with the migration’s canonical `models` output.
2. Smallest correct change: yes. No fallback hook, background agent, or unrelated model-resolution behavior from draft PR #6516 was copied.
3. Type safety: yes. Zod defines the new input shape; no `any`, ignore directive, or suppression was added.
4. Boundary behavior: yes. Canonical input is accepted at the config boundary and materialized once into existing runtime fields.
5. Adjacent policy preserved: yes. Only `[opencode]` is excluded from canonical deprecation scanning; `[senpi]` and `[codex]` remain covered.
6. Tests can fail for the regressions: yes. Both original tests were observed RED for the named failure; the adjacent harness test was also observed RED before narrowing.
7. Operational proof: yes. Real migration, idempotence, doctor configuration checks, runtime loading, DB isolation, and teardown were observed.

## Diff review

- `git diff --check`: clean.
- Final tracked scope: two required generated schema assets and six OpenCode source/test files.
- All changed TypeScript files are below 250 pure code lines.
- No unrelated generated Codex/Senpi outputs remain.

Tier remains HEAVY because the change affects persisted config migration and crosses validation, doctor, generated schemas, and runtime agent model selection.
