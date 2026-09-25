# Plan: Fix #6799 - single-provider install writes opencode/gpt-5-nano into 14 agents/categories

## Root cause (file:line)

`packages/omo-opencode/src/cli/model-fallback.ts`, `generateModelConfig()`:

- L24 `ULTIMATE_FALLBACK = "opencode/gpt-5-nano"` - hardcoded literal that is not resolvable on the current opencode zen catalog (per #6799 report).
- L270 category loop else branch: when `resolveModelFromChain(chain, avail)` returns null (installed provider is not in the category's fallbackChain), writes `{ model: ULTIMATE_FALLBACK }`.
- L246 agent loop else branch: same fall-through for agents.
- L212 explore special-case final else: same dead literal.
- L201 explore zen branch: hardcodes the same dead literal even though zen IS available.
- Zero-provider branch L167-179 also writes the literal, but with zero providers nothing is resolvable; unchanged by this fix.

Repro (#6799): install selecting only zai-coding-plan -> oracle, explore, prometheus, metis, momus, atlas, sisyphus-junior + ultrabrain, deep, artistry, quick, unspecified-low, unspecified-high, writing = 14 entries all written as `opencode/gpt-5-nano` -> ProviderModelNotFoundError at runtime. Regresses the per-category chain resolution behavior restored by #3924 (commit cfab5caea).

## Fix design (issue option A: make the ultimate fallback defer to installed providers)

In `model-fallback.ts` only; no changes to model-core chains (keeps runtime resolution untouched):

1. Add `getUltimateFallbackChain()` = maintained sisyphus chain (`getSisyphusFallbackChain()`) + two gap rungs so EVERY installer-selectable provider resolves:
   - `{ providers: ["google"], model: "gemini-3.1-pro", variant: "high" }` (same data as oracle's google rung)
   - `{ providers: ["minimax-coding-plan", "minimax-cn-coding-plan"], model: "MiniMax-M3" }` (same data as librarian/atlas rungs)
   Sisyphus chain already covers anthropic, github-copilot, opencode(zen), vercel, opencode-go, kimi-for-coding, bailian-coding-plan, openai, zai-coding-plan.
2. Add `resolveUltimateFallbackConfig(avail)`: resolve via that chain, return plain `{ model }` (no variant), falling back to the ULTIMATE_FALLBACK literal only if the chain resolves nothing (unreachable whenever hasAnyProvider, kept for type totality).
3. Replace the four dead-literal write sites: L201 -> `opencode/big-pickle` (zen's live cheap model, already used by sisyphus rung 5), L212/L246/L270 -> `resolveUltimateFallbackConfig(avail)`.

Result: every generated `agents.*.model` / `categories.*.model` entry is resolvable by at least one installed provider; roles whose own chains match keep their existing per-category models (visual-engineering glm-5.2, multimodal-looker glm-4.6v under zai-only, etc.).

## Tests (failing FIRST, co-located, given/when/then)

`model-fallback.test.ts`:
- NEW: zai-only install pins all 14 previously-broken roles to resolvable `zai-coding-plan/glm-5.2`, asserts JSON output contains no `opencode/gpt-5-nano`, and pins roles with own-chain coverage (sisyphus, visual-engineering, multimodal-looker glm-4.6v).
- NEW: minimax-only install pins a fallen-through agent (momus) to `minimax-coding-plan/MiniMax-M3` (covers appended gap rung).
- UPDATE: "explore uses gpt-5-nano when only Gemini available" -> now expects `google/gemini-3.1-pro-preview` (google gap rung; transform adds -preview suffix).
- UPDATE: "Metis resolves to OpenAI when only OpenAI is available" -> now expects `openai/gpt-5.6-sol` instead of the dead literal (test name finally matches assertion).

`model-fallback-providers.test.ts`:
- UPDATE: zen-only explore test -> expects `opencode/big-pickle` ("avoids retired OpenCode identifiers" intent preserved).

Expected RED before fix, GREEN after. Baseline pre-change: 52 pass across both files.

## Verification

1. `bun test packages/omo-opencode/src/cli/model-fallback.test.ts packages/omo-opencode/src/cli/model-fallback-providers.test.ts`
2. `bun run typecheck` (tsgo root + script + packages)
3. Evidence to `.omo/evidence/20260824-6799-single-provider-install/` (WHAT TESTED / OBSERVED / WHY ENOUGH / OMITTED)

## Out of scope (documented in PR Risk)

- Zero-provider branch still writes the literal (nothing is resolvable with no providers; warning UI text references it).
- Runtime resolution (delegate-task/category-resolver) untouched.
- No model-core chain edits.
