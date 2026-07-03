# prompt-preset Extension Changes

## Overview
Per-model prompt preset extension. Selects a tuned system prompt based on the active model and exposes it through the dynamic prompt builder.

## Files
- `index.ts` - Extension entry point; resolves a preset on session start and on model switch.
- `presets.ts` - Preset name resolution (model id -> preset name) and prompt builder dispatch.
- `settings.ts` - User-overridable preset selection from `settings.json`.
- `gpt-5.ts` / `gpt-5.2.ts` / `gpt-5.3-codex.ts` / `gpt-5.4.ts` / `gpt-5.5.ts` - GPT-5.x preset prompt builders.
- `claude-opus-4-{5,6,7}.ts` / `kimi-k2-{6,7}.ts` - Other family presets.
- `file-operations.ts` - Shared codex-style "File operations" tuning block consumed by every GPT-5.x preset.

## Claude Opus 4.5-4.8 tuning rewrite against Anthropic overlay docs (2026-07-02)

### What changed
- Rewrote the `tuningSection` of all four Opus presets (`claude-opus-4-{5,6,7,8}.ts`) from first principles against Anthropic's published Opus 4.7/4.8 prompting guidance.
- Deleted dead weight: "maintain coherent state" (a documented native strength — zero information), "do not re-anchor with reminder paragraphs" (redundant with the shared Style no-announcement rules), "do X then Y, follow that exact sequence" (literal models do this natively), the 4.5 caveat-closer ban (redundant with the shared Style permission-begging ban), and the 4.6 "constrain with 'one sentence'" line (prompt-author guidance misframed as a model instruction).
- Added documented deltas the shared prompt does not carry: tools-over-reasoning extended to 4.7 (the tendency is documented starting at 4.7; previously only 4.8 had it), literalism compensation phrased as evident-intent scope with a mandatory scope statement, the persistent cream/serif/terracotta frontend house-style override (4.7/4.8), post-user-turn reasoning economy (4.8 reasons more after user turns in interactive settings), and one harness fact on every Opus preset: senpi auto-compacts context, so never wrap up early (context-aware 4.5+ models otherwise wind down near the limit; mirrors the Fable 5 preset line).
- Kept the family-signal phrases pinned by `prompt-presets-extension.test.ts` ("ordered steps", "full set rather than the first item", "tool calls over reasoning") so existing coverage still locks preset identity.

### Why
- The old tunings restated behaviors Opus 4.7/4.8 exhibit natively while omitting the behaviors Anthropic documents as needing prompt-level overrides in a coding harness. Every remaining line now either overrides a documented model prior or states a harness fact the model cannot derive.

### Why extension system couldn't handle this differently
- The change lives entirely inside the builtin `prompt-preset` extension's Opus tuning strings; no core prompt code changed.

### Expected merge conflict zones on next upstream sync
- LOW: `claude-opus-4-{5,6,7,8}.ts` tuning template literals if upstream revises its own Opus tuning.

## Kimi K2.7 catalog coverage + colon-tag boundary (2026-06-15)

### What changed
- Documented the existing `kimi-k2-7` preset across the stale docs that still listed only `kimi-k2-6`: root `README.md` (builtin map + extension table), `builtin/AGENTS.md` inventory, and this extension's `AGENTS.md` (header, FILES tree, `kimi-k2-7.ts` row).
- Extended the trailing boundary of both Kimi matchers in `presets.ts` (`hasKimiK26Signal`, `hasKimiK27Signal`) from `(?:$|[/@._-])` to `(?:$|[/@._:-])` so colon-tagged ids like `moonshotai/kimi-k2.6:thinking` / `moonshotai/kimi-k2.7:thinking` resolve to the Kimi preset instead of falling back to the default dynamic prompt.
- Added regression coverage in `prompt-presets-extension.test.ts`: explicit `it.each` cases for the real catalog K2.7 "code" family across providers (Cloudflare, Fireworks model + router, Moonshot, OpenRouter, Baseten, plus a `:thinking` colon case), a catalog-wide `getKimiK27CatalogModels()` scan asserting every built-in K2.7 model resolves to `kimi-k2-7`, and a K2.6 `:thinking` regression. Kept the test helper signal regexes in sync with the matcher.

### Why
- The `kimi-k2-7` preset, matcher, and settings value already shipped, but every prose surface still said "Kimi K2.6" only. The catalog (`models.generated.ts`) carries nine K2.7 entries (the `kimi-k2.7-code` / `kimi-k2p7-code` family plus a name-only `kimi-coding/k2p7`); all already resolved, but nothing locked that guarantee.
- `:thinking` is a real upstream tag shape on the K2.x line in the models.dev catalog (`kimi-k2.5:thinking`, `kimi-k2.6:thinking`). The old boundary class excluded `:`, so any such id silently missed the Kimi tuning. No colon-tagged Kimi id is in senpi's bundled catalog yet, so this is a forward-looking robustness fix with zero change to current catalog resolution.

### Why extension system couldn't handle this differently
- All changes live inside the builtin `prompt-preset` extension (matcher + tests) and docs; no core prompt code changed.

### Expected merge conflict zones on next upstream sync
- LOW: `presets.ts` Kimi matcher boundary and the Kimi case tables in `prompt-presets-extension.test.ts` if upstream adds its own Kimi aliases.

## Model-level promptPreset metadata (2026-05-12)

### What changed
- `presets.ts` now reads `model.promptPreset` after the global/project `settings.json` hard override and before model-id auto detection.
- `settings.ts` exports `parsePromptPreset()` so resolver paths use the same valid preset parser.
- Added regression tests covering model-level preset resolution and settings precedence.

### Why
- `models.json` is the right place for per-model routing metadata such as “this provider-specific alias should use the Kimi preset.” The prompt-preset extension owns preset-name interpretation, while the model registry only preserves the string metadata.

### Why extension system couldn't handle this differently
- The extension system is the consumer, but it needs the selected model object to already carry metadata from `models.json`. The companion core change adds that metadata preservation without moving preset-name interpretation into core.

### Expected merge conflict zones on next upstream sync
- LOW: `presets.ts` precedence order and `settings.ts` parser export if upstream adds its own model-level preset routing.

## Kimi K2.6 p6 model-id alias (2026-05-12)

### What changed
- Extended the Kimi K2.6 auto preset matcher so model IDs like `kimi-k2p6-turbo` resolve to the existing `kimi-k2-6` preset, alongside the previous dotted `kimi-k2.6-*` IDs.
- The matcher now checks both model ID and catalog model name, so built-in catalog aliases such as Cloudflare, Fireworks `kimi-k2p6`, Moonshot, OpenRouter, Together, and Vercel Kimi K2.6 entries all resolve to `kimi-k2-6`.
- Added a prompt-preset regression case for `kimi-k2p6-turbo`.
- Added catalog-wide coverage that scans built-in Kimi K2.6/K2p6 models and verifies each one resolves to `kimi-k2-6`.
- Documented the existing `promptPreset` setting in `docs/settings.md` so users can force `kimi-k2-6` through global or project settings when auto-detection is not desired.

### Why
- Some providers encode the K2.6 family with `p6` rather than `.6`. Without this alias, those models fell back to the default senpi dynamic prompt instead of the Kimi-specific tuning.

### Why extension system couldn't handle this differently
- This is implemented inside the builtin `prompt-preset` extension's model-family dispatch; no core prompt code needed to change.

### Expected merge conflict zones on next upstream sync
- LOW: `presets.ts` Kimi matcher and the Kimi case table in `prompt-presets-extension.test.ts` if upstream adds its own Kimi aliases.

## Codex-style File operations tuning (2026-05-07)

### What changed
- Added `file-operations.ts` exposing `buildFileOperationsTuning()` - a single source-of-truth paragraph that anchors `apply_patch`, `read`, and the senpi `grep` tool as canonical verbs and forbids inline python/sed/awk/heredoc-driven file mutation through bash.
- Every GPT-5.x preset (`gpt-5.ts`, `gpt-5.2.ts`, `gpt-5.3-codex.ts`, `gpt-5.4.ts`, `gpt-5.5.ts`) now appends this tuning block to its `tuningSection`.

### Why
- senpi's prior dynamic prompt mentioned `apply_patch` only inside the function-calling schema; the prompt body had no positive routing for it. Combined with the absence of an inline-python guard, this let GPT's "files = python" pre-training prior fire unchecked. Codex's GPT-5.2 prompt (`codex-rs/core/gpt_5_2_prompt.md`) handles the same prior with explicit "Use the apply_patch tool" + "Do not use python scripts to attempt to output larger chunks of a file" lines; we mirror that here.
- The `apply_patch` tool itself already exposes `promptSnippet` + `promptGuidelines` (locked in by tests added this turn), but those only land in the senpi `## Available Tools` / `## Tool Guidelines` sections; the codex-style File operations paragraph reinforces the same guard inside the tuning section so the signal lands twice through different prompt mechanics. Negative-only directives lose to strong priors; we pair positive routing with a negative guard.
- The shared helper keeps the five preset files DRY and prevents drift; a single edit updates every GPT-5.x prompt.
- The "use the `grep` tool, not bash-invoked grep/rg" line addresses the senpi-vs-codex inconsistency: codex recommends the `rg` binary because codex has no first-class `grep` tool, but senpi exposes a ripgrep-backed `grep` tool that should be preferred over either external binary.

### Why extension system couldn't handle this differently
- This *is* the extension system. The change lives entirely inside the `prompt-preset` builtin extension; no upstream source files outside `builtin/` were touched for this part.

### Expected merge conflict zones on next upstream sync
- LOW: `gpt-5{,.2,.3-codex,.4,.5}.ts` `tuningSection` template literals - upstream has no equivalent helper. If upstream adds its own tuning lines, append rather than overwrite the file-operations block.
- LOW: `file-operations.ts` is new and additive; no upstream counterpart.
