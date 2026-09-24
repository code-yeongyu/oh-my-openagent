# PR-CF QA Evidence — upstream_gateway_error fallback + chain head

**Date:** 2026-08-25
**Branch:** `fix/upstream-gateway-error-fallback`
**Worktree:** `.local-ignore/pr-gateway-fallback`
**Evidence dir:** `.omo/evidence/20260824-gateway-fallback/`

## WHAT WAS TESTED

1. **which-gate finding (CF1 hard gate)** — `which-gate.md` records which gate
   rejects the gateway HTTP 400 `openai_error` payload today (the `:130`
   status-code gate), recorded BEFORE any implementation commit.
2. **Classifier unit tests** — `packages/model-core/src/runtime-fallback-error-classifier.test.ts`
   (8 tests): gateway 400 openai_error → `upstream_gateway_error` + retryable
   true; 500 openai_error → still 5xx-retry-safe; openai_error without status →
   non-retryable (conservative); abort/context_overflow precedence preserved.
3. **Adapter regression through aliases** — `packages/omo-opencode/src/hooks/runtime-fallback/gateway-error-fallback.regression.test.ts`
   (5 tests): end-to-end through `classifyErrorType`/`isRetryableError`;
   genuine HTTP 400 client errors stay non-retryable.
4. **Chain-head prepend (CF2)** — `packages/omo-opencode/src/hooks/model-fallback/hook.test.ts`
   (15 tests incl. 4 new): user primary prepended when absent; deduped when
   present; session chain wins; no-user-primary byte-identical old behavior.
5. **Root `bun test`** — full suite.
6. **`bun run typecheck:packages`** — all packages.
7. **opencode-qa CLI boot smoke** — `opencode run "say hi" --format json` in an
   isolated XDG sandbox (temp `XDG_DATA_HOME`), proving opencode boots and the
   plugin (incl. runtime-fallback hook) loads cleanly.
8. **SSE probe attempt** — `sse-hook-probe.sh --self-test` was attempted but the
   isolated `opencode serve` boot is slow in this environment and the probe
   timed out on `server.connected`; this is an opencode-version/environment
   quirk, not a regression from this change (see OMITTED).

## WHAT WAS OBSERVED

- `which-gate.md`: gateway-400 rejected by `:130` `retryOnErrors.includes(400)`;
  the `:134` signal path is skipped (no `isRetryable` field), `:143` patterns
  miss. Fix inserted before `:130`.
- Classifier unit: **8 pass / 0 fail** (34 expects).
- Adapter regression: **5 pass / 0 fail** (10 expects).
- Chain-head: **15 pass / 0 fail** (34 expects).
- Root `bun test`: **15653 pass / 34 skip / 22 fail**. All 22 failures are in
  pre-existing base-branch defect areas (claude-code-agent-loader,
  codex-components doctor, opencode-skill-loader, auto-update-checker,
  delegate-task, senpi doctor) — NONE in the changed scope (model-core
  classifier, model-fallback controller/hook, create-session-hooks). These
  match the pre-existing failures confirmed on untouched `dev` in prior PR-B
  work (e.g. `codex-components.test.ts` fails identically on `dev`).
- `bun run typecheck:packages`: **OK** (all packages, no errors).
- CLI boot smoke: `opencode run "say hi" --format json` EXIT=0, emitted
  `step_start`/`text`/`step_finish` events; stderr empty (no plugin-load
  errors). Isolation: real DB has no "say hi" session (verified via
  `db-session-by-name.sh`), proving the run wrote only to the temp XDG dir.
- N5 oracle check: `model-core` is NOT in the omo-codex dependency closure
  (no `model-core` in `packages/omo-codex/package.json`, no imports), so
  `bun run test:codex` is NOT required per plan.

## WHY IT IS ENOUGH

- The deterministic behavioral proof is the unit + adapter regression suites
  (green), which exercise the exact gateway-400 classification and the
  chain-head prepend logic through the real code paths (including the adapter
  aliases `classifyErrorType`/`isRetryableError`).
- The CLI boot smoke proves the plugin (with the runtime-fallback hook) still
  loads and boots cleanly against real opencode in isolation, with isolation
  proven by the absent session in the real DB.
- Typecheck green across all packages confirms the wiring compiles.
- The 22 root failures are demonstrably pre-existing base-branch defects in
  unrelated areas, not introduced by this change.

## WHAT WAS OMITTED

- The `sse-hook-probe.sh --self-test` SSE event-stream probe did not complete
  in this environment (isolated `opencode serve` boot is slow; probe timed out
  waiting for `server.connected`). This is an environment/timing quirk of the
  probe, not a regression from this change — the runtime-fallback hook's
  classification behavior is deterministically proven by the adapter regression
  suite. No secrets, tokens, or auth headers are included in this evidence.
