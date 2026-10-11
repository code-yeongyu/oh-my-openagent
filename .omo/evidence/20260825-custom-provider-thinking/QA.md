# QA Evidence: custom-provider thinking (#3434)

## WHAT WAS TESTED

- Command (red, before fix): `bun test packages/omo-opencode/src/plugin/chat-params.test.ts`
  with only the co-located test change applied (source fix stashed).
- Command (green, after fix): `bun test packages/omo-opencode/src/plugin/chat-params.test.ts packages/omo-opencode/src/hooks/think-mode/ packages/model-core/src/model-settings-compatibility.test.ts`
- Typecheck: `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json` (clean, no output).
- Surface driven: the `chat.params` plugin handler (`createChatParamsHandler`) that OpenCode
  invokes with the merged request options immediately before the LLM call.

## WHAT WAS OBSERVED

- Red: new test "injects anthropic thinking when variant cannot resolve on a metadata-less
  custom provider" failed with `output.options.thinking` = undefined
  (see red-before-fix.txt). This reproduces issue #3434: a desired variant ("high", from the
  think keyword or an agent default) is a silent no-op for custom providers because OpenCode
  core resolves variant options exclusively from models.dev provider metadata
  (`input.model.variants`), which custom providers do not have.
- Green: same test passes; handler now injects
  `options.thinking = { type: "enabled", budgetTokens }` (level-mapped: high=16000,
  max/xhigh=31999, medium=8000, low=4000) and removes the unresolvable raw message variant,
  but ONLY when all of these hold:
  - a variant survived compatibility resolution,
  - the model SDK package (`model.api.npm`) is Anthropic-compatible
    (`@ai-sdk/anthropic`, `@ai-sdk/google-vertex/anthropic`),
  - no thinking / effort / reasoningEffort is already present in options (so core-resolved
    variants and user-configured options are never overwritten or doubled).
- No regressions: 116/116 pass across chat-params + think-mode + model-settings-compatibility
  suites (green-after-fix.txt); full scoped run including model-capabilities suites was
  153/153 pass during development.

## WHY IT IS ENOUGH

The injection gate keys on observable request state (existing thinking/effort in
`output.options`), not on guessed provider catalogs. When OpenCode core CAN resolve the
variant it has already merged concrete options into `output.options` before this hook fires,
so the guard skips and behavior is byte-identical to today for every known provider. When
core cannot resolve it (custom providers), the hook materializes Anthropic-native thinking
options, which reach the SDK via the existing providerOptions mapping. Non-anthropic SDK
packages are explicitly untouched (pinned by the second new test).

## WHAT WAS OMITTED

No live end-to-end opencode session was driven (would require network access to a real
Anthropic-compatible endpoint, unavailable in this environment); the hermetic handler-level
proof plus the core merge-order analysis covers the changed seam. No secrets, tokens, or env
dumps are contained in the captured artifacts.
