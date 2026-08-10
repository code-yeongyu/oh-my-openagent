# Task 13a evidence - senpi-telemetry reference prose

Date: 2026-08-10
Scope: docs/reference/senpi-telemetry.md only (prose around the generated sentinel block; block untouched).

## Drift test (generated block byte-identical to generator output)

Command:

```
bun test packages/omo-senpi/src/components/telemetry/schema-doc.test.ts
```

Output:

```
 2 pass
 0 fail
 1 expect() calls
Ran 2 tests across 1 file. [991.00ms]
```

## Markdown link audit

Command:

```
bun test packages/omo-opencode/src/shared/markdown-link-audit.test.ts
```

Output:

```
 16 pass
 0 fail
 21 expect() calls
Ran 16 tests across 1 file. [239.00ms]
```

## Doc QA capture A: sentinel count (exactly 2 hits)

Command:

```
rg -n 'BEGIN GENERATED SCHEMA|END GENERATED SCHEMA' docs/reference/senpi-telemetry.md
```

Output:

```
9:<!-- BEGIN GENERATED SCHEMA -->
21:<!-- END GENERATED SCHEMA -->
```

## Doc QA capture B: grep checklist on senpi-telemetry.md

Command:

```
for p in 'daily_active' 'session_started' 'prompt_submitted' 'turn_completed' 'skill_loaded' 'delegation_started' 'feature_used' 'Opt-out matrix' 'What is never collected'; do rg -qn "$p" docs/reference/senpi-telemetry.md && echo "PASS: $p" || echo "FAIL: $p"; done
```

Output:

```
PASS: daily_active
PASS: session_started
PASS: prompt_submitted
PASS: turn_completed
PASS: skill_loaded
PASS: delegation_started
PASS: feature_used
PASS: Opt-out matrix
PASS: What is never collected
```

## Doc QA capture C: NEGATIVE CONTROL against codex-telemetry.md (must fail)

Command:

```
for p in 'daily_active' 'session_started' 'prompt_submitted' 'turn_completed' 'skill_loaded' 'delegation_started' 'feature_used' 'Opt-out matrix' 'What is never collected'; do rg -qn "$p" docs/reference/codex-telemetry.md && echo "PASS: $p" || echo "FAIL: $p"; done
```

Output:

```
PASS: daily_active
FAIL: session_started
FAIL: prompt_submitted
FAIL: turn_completed
FAIL: skill_loaded
FAIL: delegation_started
FAIL: feature_used
FAIL: Opt-out matrix
FAIL: What is never collected
```

8 of 9 checks fail on the codex doc (`daily_active` matches only because codex mentions `omo_codex_daily_active`). The checklist discriminates and is not vacuously true.

## Style checks

- `rg -n $'\u2013|\u2014' docs/reference/senpi-telemetry.md` -> no em or en dashes.

## Cleanup receipt

- No scratch files, temp copies, or desync experiments created by this task.
- Files touched: docs/reference/senpi-telemetry.md, this evidence file.
- docs/reference/omo-json.md NOT touched (owned by 13b). Generator, drift test, and source files NOT touched.
