# builtin/prompt-preset

Builtin extension #3. On `before_agent_start` and `model_select`, picks a system prompt preset by **model family** (gpt-5.x, claude-fable-5, claude-opus-4-{5,6,7,8}, glm-5.2, kimi-k2-{6,7}) and falls back to the senpi dynamic prompt when nothing matches. Renders the active preset name in the startup header. After 2026-04-30, presets are thin wrappers around `buildDynamicSystemPrompt()` carrying only model-specific tuning.

## FILES

```
prompt-preset/
├── index.ts             # Extension entry — hooks before_agent_start + model_select
├── presets.ts           # Model-id matchers + dispatch (resolvePresetName, resolvePreset)
├── settings.ts          # PromptPresetName settings type ("auto" | family ids)
├── file-operations.ts   # Shared "use apply_patch, not python heredoc" tuning block (codex-style)
├── gpt-5.ts             # GPT-5 baseline preset
├── gpt-5.2.ts           # GPT-5.2 preset
├── gpt-5.3-codex.ts     # GPT-5.3 Codex preset
├── gpt-5.4.ts           # GPT-5.4 preset
├── gpt-5.5.ts           # GPT-5.5 preset
├── claude-fable-5.ts    # Claude Fable 5 preset
├── claude-opus-4-5.ts   # Claude Opus 4.5 preset
├── claude-opus-4-6.ts   # Claude Opus 4.6 preset
├── claude-opus-4-7.ts   # Claude Opus 4.7 preset
├── claude-opus-4-8.ts   # Claude Opus 4.8 preset
├── glm-5-2.ts           # GLM 5.2 preset
├── kimi-k2-6.ts         # Kimi K2.6 preset
├── kimi-k2-7.ts         # Kimi K2.7 preset
└── changes.md           # Fork tracker (model-family rename 2026-04-30, file-operations 2026-05-07)
```

## WHERE TO LOOK

| Task | File |
|------|------|
| Add a preset for a new model release | new `<family>.ts` + entry in `presets.ts` |
| Tune GPT-5.x file-handling guidance | `file-operations.ts` (all GPT presets append it) |
| Adjust model-id → preset matching | `presets.ts` `resolvePresetName()` |
| User override via settings | `settings.ts` `PromptPresetName` |

## PRESET SHAPE (post 2026-04-30)

```typescript
function buildGpt55Tuning(): string {
   return `…model-specific addenda…

${buildFileOperationsTuning()}`;
}

export function buildGpt55Prompt(options: BuildDynamicSystemPromptOptions): string {
   return buildDynamicSystemPrompt({ ...options, tuningSection: buildGpt55Tuning() });
}
```

Each preset is ~10 lines. The shared default in `dynamic-prompt/` carries identity, intent gate, exploration, parallel-tools, verification, policies, style. Preset only carries **what's different for that model family**.

## CONVENTIONS

- **Model-family naming, not personas**: presets are named after the model they target (`gpt-5.ts`, not `coder.ts`). The 2026-04-30 rename removed persona-style names.
- **`file-operations.ts` is appended to EVERY GPT-5.x preset**. New GPT preset → mirror this. Negative-only directives lose to model priors; pair them with positive routing.
- **`resolvePresetName()` is cheap** (used by startup header). `resolvePreset()` builds the full prompt — call only when needed.
- **Don't duplicate identity / intent / exploration** in a preset — they're already in the default builder.

## ANTI-PATTERNS

- Renaming a preset file to a persona ("coder", "architect", "thinker") — was tried, reverted.
- Embedding full prompt scaffolding in a preset — defeats the point of the 2026-04-30 thin-wrapper architecture.
- Adding a non-GPT preset that copies `buildFileOperationsTuning()` — the apply_patch routing is GPT-specific.
- Mutating `BuildDynamicSystemPromptOptions` before passing through — pass via spread, add only `tuningSection`.

## NOTES

- Tests under `packages/coding-agent/test/suite/prompt-presets-*.test.ts` validate that each preset produces a non-empty `tuningSection` and contains the model-family signal.
- The fork rationale: senpi is a neutral coding agent; persona-named presets collapsed identity into specific personas and made `--model` ↔ active preset hard to reason about. Family naming is the canonical resolution.
- Adding a new model release: copy the closest existing preset, replace the model family in the test, update `presets.ts` matcher, add a regression test.
