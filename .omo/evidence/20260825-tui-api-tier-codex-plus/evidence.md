# Evidence: #5187 TUI auto-configuring API-tier Codex/Terra for ChatGPT Plus

Date: 2026-08-25
Branch: issue/5187-tui-api-tier-codex-plus
Worktree: /home/viprix/projects/oom-wt-5187

## WHAT WAS TESTED

Scoped Bun tests, co-located with the changed CLI sources:

```
bun test packages/omo-opencode/src/cli/install-validators.test.ts packages/omo-opencode/src/cli/model-fallback.test.ts
bun test packages/omo-opencode/src/cli/
bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json
```

Surfaces driven: `argsToConfig` / `validateNonTuiArgs` (CLI arg -> InstallConfig mapping),
`generateModelConfig` (model config generation by provider availability), plus the full
`packages/omo-opencode/src/cli/` suite as the regression net for neighboring installer/prompt tests.

Behavior proven:
- `--openai` now accepts subscription tiers (`no|yes|api|plus|pro`); invalid values are rejected with an updated message.
- `argsToConfig` maps tiers to `openaiPlan`: plus->plus, pro->pro, api->api, legacy yes->api, no->none; `hasOpenAI` true for any non-none plan.
- With `openaiPlan: "plus"` or `"pro"`, no generated agent/category (primary or fallback_models) targets the API-only catalog model `openai/gpt-5.6-terra`; momus/oracle resolve to `openai/gpt-5.6-sol`.
- Legacy `openaiPlan: "api"` keeps the unchanged API-catalog behavior (momus primary terra, unspecified-low terra).

## WHAT WAS OBSERVED

Failing-first (before the fix, partial-work tests only):

```
 44 pass
 4 fail
Ran 48 tests across 2 files.
(fail) argsToConfig > #5187 maps --openai subscription tiers to openaiPlan
       Expected: "plus"  Received: undefined
(fail) validateNonTuiArgs > rejects invalid --openai values
       Expected: "(expected: no, yes, api, plus, pro)"  Received: "(expected: no, yes)"
(fail) generateModelConfig > #5187 ChatGPT subscription tier detection > Plus-tier OpenAI users never receive API-only openai models
(fail) generateModelConfig > #5187 ChatGPT subscription tier detection > Pro tier is treated as a ChatGPT subscription for the API-only catalog
```

After the fix:

```
bun test packages/omo-opencode/src/cli/install-validators.test.ts packages/omo-opencode/src/cli/model-fallback.test.ts
 48 pass
 0 fail
 122 expect() calls

bun test packages/omo-opencode/src/cli/
 709 pass
 0 fail
 1606 expect() calls
Ran 709 tests across 98 files. [15.46s]

bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json
(no output, exit 0)
```

Root cause (for the record): the TUI asked a boolean "OpenAI/ChatGPT Plus subscription?" question and
`argsToConfig` collapsed it into `hasOpenAI`, which `toProviderAvailability` maps to `native.openai`.
All fallback-chain resolution then treated the openai provider as fully available, so API-only rungs
(`gpt-5.6-terra`, formerly `gpt-5.3-codex`) in momus/oracle and unspecified-low/high chains resolved
as primary models that Plus subscribers cannot authenticate against.

Fix shape: thread `openaiPlan` through `InstallConfig` -> `ProviderAvailability` and make chain
resolution model-aware via `isModelAvailableOnProvider()` — the `openai` provider is unavailable for
API-only models when the plan is a ChatGPT subscription (plus/pro). Other providers on the same chain
rungs (github-copilot/vercel) keep their own availability semantics.

## WHY IT IS ENOUGH

- The regression tests pin the exact reported failure mode (Plus user -> categories mapped to API-only codex/terra) at both seams where it manifests: arg mapping and model generation.
- The full CLI package suite (709 tests) covers all neighboring installer/prompt/fallback behavior; zero regressions.
- tsgo typecheck over the package is clean; no type suppressions added.
- The fix is provider/model-level, so mixed setups (e.g. copilot + plus) still resolve copilot rungs normally.

## WHAT WAS OMITTED

- No live TUI (@clack) interactive drive: prompt option list change is covered by compile-time types and the scoped suite; interactive selection logic (`selectOrCancel`) is unchanged.
- No real OpenAI network calls (no credentials used); tier gating is static configuration logic.
- Raw test transcripts summarized above; no secrets or tokens involved in any captured output.
