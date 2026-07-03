# changes.md — dynamic-prompt

## Test discipline rules in verification prompt (2026-05-15)

### What changed

- `verification.ts`: added a structured `TEST_DISCIPLINE_RULES` set and renders it as a dedicated `### Test Discipline` subsection inside `## Verification`.
- Added semantic rule coverage under `test/suite/prompt-verification-discipline.test.ts`, avoiding raw prompt sentence pinning while still checking that the structured rule set is injected.

### Why

- The shared verification prompt did not tell agents how to handle test code specifically. That left room for flaky waits, fixed sleep-based async tests, over-isolated mocks, and prompt tests that merely assert current prompt text.
- The new rules live in `verification.ts` because they define validation quality, not model-family tuning.

### Why extension system couldn't handle this

- This is shared base-prompt behavior for every preset and fallback prompt. Per-extension prompt riders would apply too late or only in specific extension configurations.

### Expected merge conflict zones

- LOW: `verification.ts` if upstream rewrites the V1/V2/V3 verification section.

## Dynamic System Prompt (2026-04-05)

### What changed

- `agent-session.ts`: `_rebuildSystemPrompt()` calls `buildDynamicSystemPrompt()` instead of `buildSystemPrompt()`. References to `loaderSystemPrompt` (SYSTEM.md) and `loaderAppendSystemPrompt` (APPEND_SYSTEM.md) removed.
- `resource-loader.ts`: Removed SYSTEM.md / APPEND_SYSTEM.md discovery, loading, override, and storage. `getSystemPrompt()` returns `undefined`, `getAppendSystemPrompt()` returns `[]`. Interface methods kept for compatibility.
- New directory `dynamic-prompt/` with 7 files:
  - `types.ts` — AvailableTool interface
  - `tool-categorization.ts` — categorizeTools(), getToolsPromptDisplay()
  - `intent-gate.ts` — Phase 0 intent gate with dynamic key triggers
  - `tool-section.ts` — Categorized tool display with snippets and guidelines
  - `policies.ts` — Hard blocks and anti-patterns
  - `build.ts` — buildDynamicSystemPrompt() assembler
  - `index.ts` — re-exports

### Why

- Replace static pi default prompt with dynamic prompt that adapts to registered tools
- Add intent classification gate (Phase 0) to system prompt
- Remove SYSTEM.md / APPEND_SYSTEM.md file-based prompt overrides

### Why extension system couldn't handle this

The base prompt itself (what `_rebuildSystemPrompt` produces) needed replacement. Extensions can only modify it per-turn via `before_agent_start`, not replace the default builder.

### Modified upstream files

- `agent-session.ts` — 1 import changed, ~6 lines removed in `_rebuildSystemPrompt()`
- `resource-loader.ts` — ~77 lines removed (SYSTEM.md/APPEND_SYSTEM.md machinery)

### Expected merge conflict zones

- `agent-session.ts` line ~904: the `buildSystemPrompt()` call. Resolution: keep `buildDynamicSystemPrompt()`, update args if upstream adds new parameters.
- `resource-loader.ts`: `reload()` method near line 450. Resolution: drop any new SYSTEM.md/APPEND_SYSTEM.md code upstream adds.

## Remove LSP/AST Categories + Generalize Hero Line (2026-04-11)

### What changed

- `build.ts`: Hero line changed from coding-specific ("expert coding assistant operating inside pi") to generic ("You are a helpful assistant."). Two supporting coding-context lines removed.
- `types.ts`: `AvailableTool.category` union narrowed from 6 to 4 values (removed `"lsp"` | `"ast"`).
- `tool-categorization.ts`: Removed `lsp_` and `ast_grep` prefix detection in `getToolCategory()`. Removed `lsp_*` and `ast_grep` entries from `getToolsPromptDisplay()`.
- `tool-section.ts`: Removed `"lsp"` and `"ast"` from `CATEGORY_ORDER` and `CATEGORY_LABELS`.
- Tests updated: `build.test.ts`, `tool-categorization.test.ts`, `intent-gate.test.ts`, `tool-section.test.ts` — all lsp/ast-specific test cases removed or converted.

### Why

- System prompt should be domain-agnostic (not coding-specific).
- LSP and AST tool categories are not used in this fork's tool set.

### Why extension system couldn't handle this

These are core type definitions and prompt builder internals, not per-turn modifications.

### Modified upstream files

All changes are within the `dynamic-prompt/` directory which is already a fork modification.

### Expected merge conflict zones

- `types.ts`: If upstream adds the `"lsp" | "ast"` categories. Resolution: keep narrowed union.
- `tool-categorization.ts`, `tool-section.ts`: If upstream references lsp/ast categories. Resolution: drop those references.

## Prompt Leakage Guard (2026-04-10)

### What changed

- `intent-gate.ts`: Replaced "verbalize intent" wording with an internal-only routing step.
- `intent-gate.ts`: Added explicit guardrails to avoid exposing prompt scaffolding such as "Thinking level", "Step 0", or XML tool-call examples in user-facing output.
- `test/dynamic-prompt/intent-gate.test.ts`: Updated coverage to assert the internal-only wording.
- `test/dynamic-prompt/build.test.ts`: Added regression coverage to keep the assembled prompt from reintroducing `I detect ...` scaffolding.

### Why

- Gemini 3.1 Pro preview with MorphXML-style tool calling could echo prompt scaffolding into normal assistant output.
- The prior instruction explicitly asked the model to verbalize its routing decision, which encouraged user-visible leakage of internal planning text.

## Strong Default + Forced Intent Verbalization (2026-04-30)

### What changed

- `intent-gate.ts`: Reversed the 2026-04-10 "internal-only" guard. The intent gate now requires the model to emit a one-line routing line in the format `I read this as [intent] - [plan].` before acting. The guard against narrating prompt scaffolding ("Step 0", "Thinking level", XML examples) is preserved; only the routing line itself is mandated.
- `build.ts`: Replaced the `"You are a helpful assistant."` opener with a senpi identity section. Added five new reusable sections to the assembled prompt: identity, parallel tool calls, exploration discipline, verification rigor (V1/V2/V3 tiers), and style. Added an optional `tuningSection` field for per-model addenda.
- New files in `dynamic-prompt/`: `identity.ts`, `parallel-tools.ts`, `exploration.ts`, `verification.ts`, `style.ts`. Each exports a single `build*Section()` function consumed by `build.ts` and re-exported from `index.ts`.
- `test/dynamic-prompt/intent-gate.test.ts` and `test/dynamic-prompt/build.test.ts`: Updated to assert the verbalization mandate and the new sections.

### Why

- The default fallback prompt was producing weak, generic-LLM-bot output ("You are a helpful assistant." with bare intent gate, tool list, and policies). The README already advertised forced intent verbalization, but the code contradicted it. Strengthening the default reconciles README and code, and gives every model that lacks a preset a strong neutral senpi prompt.
- The 2026-04-10 leakage fix was a Gemini-specific patch applied as a global silencer. The proper place for that patch is a Gemini-specific overlay (or a per-model preset), not the shared default. Revoking it here while preserving the "do not narrate prompt scaffolding" guard restores the verbalization for every other model.
- The bold parallel-tool-calls section ("if a directory or symbol is even loosely relevant to the request, run `grep`, `ls`, and `read` in parallel") was missing entirely. Adding it makes the default suitable for agentic use without falling back to model-specific presets.

### Why extension system couldn't handle this

These are core builder internals and the shared shape of every prompt the agent emits in the absence of a preset. Extensions can only inject before/after a turn; they cannot replace the default builder.

### Modified files (this fork)

All changes are within the existing `dynamic-prompt/` directory.

### Expected merge conflict zones

- `intent-gate.ts`: If upstream re-introduces an "internal only" routing rule. Resolution: keep the verbalization mandate; reapply any additional anti-leakage guard on top of it.
- `build.ts`: If upstream rewrites the assembly. Resolution: keep the senpi identity and the new section calls.

## Preset Files Renamed to Model Families (2026-04-30)

### What changed

- `extensions/builtin/prompt-preset/`: Deleted the three persona-named preset files. Replaced with model-named files: `claude-opus.ts`, `kimi-k2-6.ts`, `gpt-5.ts`. Each new preset is a thin wrapper that calls `buildDynamicSystemPrompt` with a small `tuningSection` carrying only the model-specific notes.
- `presets.ts`: Renamed the `is*Model` helpers to model-family-named functions (`isGpt5FamilyModel`, `isClaudeOpusModel`). Split `resolvePreset` into `resolvePresetName` (cheap, used by the startup header) and `resolvePreset` (builds the full prompt). Settings overrides accept the new model-named values.
- `settings.ts`: `PromptPresetName` is now `"auto" | "claude-opus" | "kimi-k2-6" | "gpt-5"`.
- `index.ts` (extension wiring): Passes the full `BuildDynamicSystemPromptOptions` (including `cwd`, `contextFiles`, `skills`) through to the preset builders so presets reuse the strengthened default.
- All three `test/suite/prompt-presets-*.test.ts` files: Updated assertions to match the new preset names and the senpi-neutral identity.

### Why

- Senpi is a neutral coding agent. Persona-named presets collapsed identity into specific personas and made model selection hard to reason about. Naming presets after the model family they target makes the link from `--model` to active preset obvious.
- The old presets duplicated identity, intent, exploration, and verification language. Each was 100+ lines of mostly-shared content. The new architecture (default carries the shared behavior, preset carries only the model-specific tuning) cuts each preset to ~10 lines and keeps tuning easy to review.

### Why extension system couldn't handle this

Preset selection is wired through a builtin extension that already lives in this directory. The rename touches that extension's settings, selector, and tests as a single unit.

### Modified files (this fork)

All changes are within `extensions/builtin/prompt-preset/` and the matching tests under `test/suite/`.

### Expected merge conflict zones

- `presets.ts`, `settings.ts`: If upstream renames or reshapes the preset settings. Resolution: keep the model-named taxonomy.
