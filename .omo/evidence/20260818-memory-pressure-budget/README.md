# Memory pressure budget contract QA

Date: 2026-08-18
Branch: `feat/memory-system-token-budget`

## Scope exercised

- Dream worker launch payload exposes `SYSTEM_TOKENS_PATH`, `SYSTEM_TOKEN_BUDGET`, and `SYSTEM_TOKEN_TARGET`.
- The token estimate JSON preserves the command estimator's sorted per-file `{path,bytes,tokens}` records plus `totalTokens`.
- The dream persona embeds the machine-consumed `System Token Budget Contract` section.
- Post-merge completion validation records `budget_not_met` for pressure dreams at or above target, remains clean below target, and reports without failing for non-pressure origins.
- The existing remediation mapping gives a concrete trim/demote hint.

## TDD RED

Captured in `red.txt` before implementation. Expected failures included:

- `validateDreamTokenBudget` export absent.
- Persona anchor absent.
- Dream launch budget environment absent.
- `budget_not_met` fell through to the generic child-log remediation.
- A merged pressure dream above target completed without the warning.

## GREEN

`green-tests.txt` records one deterministic affected-test run:

```text
57 pass
0 fail
170 expect() calls
Ran 57 tests across 8 files.
```

Type checks:

- `tsgo-omo-senpi.txt`: `omo-senpi tsgo: PASS`
- `tsgo-memory-core.txt`: `memory-core tsgo: PASS`

Bundle verification:

- `bundle-freshness.txt`: rebuilt the extension outputs and then passed `git diff --exit-code -- packages/omo-senpi/plugin/extensions`.

## Validation severity choice

The reflection state machine has terminal outcomes, not a separate warning outcome. Treating a budget miss as `failed` after the dream commit was already merged would make successful durable memory changes look rolled back and would incorrectly advance the failure streak. The implementation therefore preserves terminal outcome `merged` and records warn-level completion metadata with `reason: budget_not_met`, the committed estimate in `detail`, and the existing remediation mapping's next-step hint. Non-pressure runs never receive the reason.
