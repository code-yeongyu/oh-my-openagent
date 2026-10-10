# Plan: fix #6452 — assistant-prefill guard misses claude-opus-5

## Root cause (file:line)
`packages/omo-opencode/src/plugin/messages-transform.ts`
- L20-24 `ASSISTANT_PREFILL_UNSUPPORTED_MODEL_PREFIXES = ["claude-opus-4", "claude-sonnet-4-6", "claude-mythos"]` — frozen exact-version prefixes.
- L155-156 `shouldRepairAssistantPrefillForModel()` does `modelID.startsWith(prefix)`.
- `"claude-opus-5".startsWith("claude-opus-4") === false`, `"claude-sonnet-5".startsWith("claude-sonnet-4-6") === false` → guard silently declines → `ensureUserTurnAfterAssistantTail()` (L208-222) never appends the synthetic user turn → non-retryable Anthropic 400 "assistant message prefill" on every submit whose history ends with an assistant turn.

## Change (single file + co-located test)
Replace the prefix array with a data-driven family table with numeric floors:

```ts
type AssistantPrefillUnsupportedModelFamily = {
  readonly family: string
  readonly minMajor?: number
  readonly minMinor?: number
}
const ASSISTANT_PREFILL_UNSUPPORTED_MODEL_FAMILIES = [
  { family: "claude-opus", minMajor: 4 },
  { family: "claude-sonnet", minMajor: 4, minMinor: 6 },
  { family: "claude-mythos" },
]
```

Matcher semantics (`matchesAssistantPrefillUnsupportedFamily`):
- exact bare family name ("claude-mythos") fires only when the family has no version floor;
- parse numeric components after `<family>-`, stopping at the first non-numeric token (suffixes like `-fast`, `-thinking`) or any token longer than 2 digits (dated snapshots like `-20250514`);
- fire when major > minMajor, or major == minMajor and (minMinor undefined or minor >= minMinor).

Parity audit vs old prefixes against every id in `src/generated/model-capabilities.generated.json`:
- unchanged FIRES: claude-opus-4, -4-1(+date), -4-5(+date), -4-6/7/8, sonnet-4-6/7/8(+variants), mythos*
- unchanged SILENT: claude-sonnet-4, sonnet-4-20250514, sonnet-4-5(+date), sonnet-4-thinking, haiku-*, gpt/gemini, openrouter bare claude ids (no anthropic namespace)
- newly FIRES (the fix): claude-opus-5, claude-opus-5-fast, claude-sonnet-5(-free), and any future claude-(opus|sonnet)-<major> >= floor.

## Test-first sequence
1. Add parameterized regression test to `messages-transform.test.ts`: given each prefill-disabled Claude release (incl. opus-5, opus-5-fast, sonnet-5) when transform runs then synthetic user recovery turn appended. Run → RED on opus-5/opus-5-fast/sonnet-5.
2. Extend negative scenario list with `claude-haiku-4-5` (prefill-capable, must stay silent).
3. Implement matcher. Run → GREEN.
4. Scoped suites: `bun test packages/omo-opencode/src/plugin/messages-transform*.test.ts`; typecheck `bun run typecheck`.

## Evidence
This dir: PLAN.md, WHAT-TESTED.md, red/red-green run logs.

## Commit / PR
One conventional commit `fix(omo-opencode): classify assistant-prefill rejection by model family floors` (+ evidence via `git add -f`, precedent d982014de), push fork branch `issue/6452-prefill-guard-opus5`, PR base `dev`, body What/Why/Verified/Risk ending `Fixes #6452`.
