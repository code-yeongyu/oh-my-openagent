# Plan — Issue #3435: Anthropic filters requests carrying literal `opencode`

## Root cause (file:line)

`packages/omo-opencode/src/shared/system-directive.ts:8`

```ts
export const SYSTEM_DIRECTIVE_PREFIX = "[SYSTEM DIRECTIVE: OH-MY-OPENCODE"
```

Every machine-generated internal directive injected into outbound chat payloads
(todo continuation, ralph/ultrawork loop, compaction context, atlas delegation,
prometheus read-only, boulder continuation) embeds the literal `opencode`
(case-insensitive match of `OH-MY-OPENCODE`). Anthropic-side filtering rejects
such requests. Confirmed by owner analysis on the issue thread twice.

Blast radius (verified by grep): ALL consumers derive from this single constant:
- `hooks/todo-continuation-enforcer/constants.ts` (createSystemDirective)
- `hooks/ralph-loop/continuation-prompt-builder.ts` (prefix interpolation)
- `hooks/atlas/system-reminder-templates.ts`, `atlas/tool-execute-before.ts`
- `hooks/compaction-context-injector/compaction-context-prompt.ts`
- `hooks/prometheus-md-only/constants.ts`
- `hooks/sisyphus-junior-notepad/hook.ts`
- `hooks/keyword-detector/hook.ts` + `todo-continuation-enforcer/non-idle-events.ts` (isSystemDirective recognition)

No second hardcoded outbound copy exists. One test fixture hardcodes the old
prefix (`todo-continuation-enforcer/non-idle-events.test.ts:88`) — kept as the
legacy-recognition proof.

## Change

1. `system-directive.ts`:
   - `SYSTEM_DIRECTIVE_PREFIX` -> `"[SYSTEM DIRECTIVE: OH-MY-OPENAGENT"` (no
     `opencode` literal; aligns with the dual-publish rename direction).
   - Add `LEGACY_SYSTEM_DIRECTIVE_PREFIX` (`...OH-MY-OPENCODE`) used ONLY for
     recognition of directives already persisted in in-flight sessions; never
     emitted.
   - `isSystemDirective()` recognizes both prefixes (ultrawork leading-keyword
     strip applies to both).
   - New `containsSystemDirective(text)` for containment dedup checks.
2. `atlas/tool-execute-before.ts` + `sisyphus-junior-notepad/hook.ts`: switch
   `.includes(SYSTEM_DIRECTIVE_PREFIX)` to `containsSystemDirective()` so
   double-injection guards keep working against legacy-format prompts.
3. Tests (failing FIRST):
   - Regression: `SYSTEM_DIRECTIVE_PREFIX`, `LEGACY_...` is not asserted clean,
     and `createSystemDirective()` output for every `SystemDirectiveTypes` value
     must NOT match `/opencode/i`.
   - Recognition parity: new prefix recognized, legacy prefix still recognized,
     ultrawork-prefixed legacy directive recognized, normal text rejected.
   - Update stale test title referencing OH-MY-OPENCODE.

## Verification

- Red run captured BEFORE fix (evidence/red-run.txt).
- Scoped green: bun test over system-directive + all consumer hook dirs.
- Typecheck: `tsgo --noEmit -p packages/omo-opencode/tsconfig.json`.

## Explicitly omitted

- Markdown prompt prose scrub (agents/*.md, prompts-core): maintainer thread
  says full scrub/re-key needs policy direction; prose contract tests are a
  forbidden anti-pattern in this repo. Documented in OMITTED.md.
- OpenCode-core user-agent/metadata strings: upstream harness surface, outside
  this plugin repo.
