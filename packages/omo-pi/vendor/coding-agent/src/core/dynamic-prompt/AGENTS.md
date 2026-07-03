# packages/coding-agent/src/core/dynamic-prompt

Fork-introduced system-prompt assembler. Replaces upstream's static `buildSystemPrompt()` with a layered builder: identity → intent gate → exploration → parallel-tools → verification → tool reference → policies → style → optional per-model tuning. Every preset under `extensions/builtin/prompt-preset/` ultimately calls into this builder. See `changes.md` for the full evolution.

## FILES

```
dynamic-prompt/
├── build.ts                # buildDynamicSystemPrompt() + BuildDynamicSystemPromptOptions — assembler, public entry
├── index.ts                # Public re-exports
├── types.ts                # AvailableTool
├── identity.ts             # buildIdentitySection() — senpi neutral identity
├── intent-gate.ts          # buildIntentGate() — Phase 0 routing line
├── exploration.ts          # buildExplorationSection() — "read the code first" discipline
├── parallel-tools.ts       # buildParallelToolsSection() — fan-out grep/ls/read in parallel
├── verification.ts         # buildVerificationSection() — V1/V2/V3 verification tiers
├── tool-categorization.ts  # categorizeTools() + getToolsPromptDisplay()
├── tool-section.ts         # CATEGORY_ORDER + CATEGORY_LABELS for rendering
├── policies.ts             # Hard blocks + anti-patterns injected into every prompt
├── style.ts                # buildStyleSection() — output formatting + length norms
└── changes.md              # Dense fork tracker (dated sections)
```

## WHERE TO LOOK

| Task | File |
|------|------|
| Change senpi identity | `identity.ts` |
| Add/modify intent classification | `intent-gate.ts` — the forced verbalization line |
| Change parallel-tool guidance | `parallel-tools.ts` |
| Add new "Don't do X" rule | `policies.ts` |
| Tune verification tier definitions | `verification.ts` |
| Add/remove a tool category | `types.ts` (`AvailableTool["category"]`) + `tool-categorization.ts` + `tool-section.ts` |
| Per-model addendum to the prompt | callers pass `tuningSection` (see `extensions/builtin/prompt-preset/`) |

## SECTION ORDER (assembled in `build.ts`)

1. **Identity** — senpi-neutral hero line
2. **Intent gate** — forced `I read this as [intent] - [plan].` routing line
3. **Exploration** — "read code before claiming"
4. **Parallel tools** — fan-out heuristics
5. **Verification** — V1/V2/V3 tiers
6. **Tool reference** — categorized snippets + guidelines from registered tools
7. **Policies** — hard blocks + anti-patterns
8. **Style** — output formatting
9. **Optional `tuningSection`** — per-model preset addendum (appended last)

## CONVENTIONS

- **Forced verbalization** (2026-04-30): every prompt mandates a `I read this as [intent] - [plan].` line. Do NOT silently revert to "internal-only" routing — the 2026-04-30 entry reversed that experiment.
- **Anti-leakage guard preserved**: the prompt forbids narrating "Step 0", "Thinking level", or XML tool-call examples in user-visible output. Keep this even if routing is verbalized.
- **No coding-specific language in the default** (2026-04-11): identity is domain-agnostic. Coding-specific tuning belongs in a preset, not here.
- **Section builders are pure functions** taking only the data they need from `BuildDynamicSystemPromptOptions` — easy to test in isolation and reuse from presets.
- **Tool categories are fork-narrowed to 4** (search/session/command/other). LSP and AST categories were removed (2026-04-11).

## ANTI-PATTERNS

- Hardcoding model-specific instructions in `build.ts` — put them in a preset's `tuningSection` instead.
- Reintroducing `lsp`/`ast` tool categories without re-adding their detection + tests.
- Replacing the senpi identity with `"You are a helpful assistant."` — was tried, produced weak generic-bot output, reverted 2026-04-30.
- Removing the intent-gate verbalization line — the README advertises it; code must match.

## NOTES

- `buildDynamicSystemPrompt(options)` is the only public entry; presets pass `tuningSection` to layer on per-model guidance.
- `changes.md` documents the layered rewrite in dated sections. Read it before touching `build.ts` or `intent-gate.ts`.
- Tests live under `packages/coding-agent/test/dynamic-prompt/` and the preset suites under `test/suite/prompt-presets-*.test.ts`.
