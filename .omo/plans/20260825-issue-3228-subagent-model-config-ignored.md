# Plan: issue #3228 — task(subagent_type) ignores agent model config (alias gap)

## Root cause

`packages/omo-opencode/src/tools/delegate-task/subagent-model-resolution.ts:18-21,31-32`
`findAgentOverride()` looks up `executorCtx.agentOverrides` only by
`getAgentConfigKey(agentToUse)` (`shared/agent-display-names.ts:122-125`), which
reverse-maps known builtin display names only. For a custom agent invoked by its
runtime registry name (e.g. `technical-writer`) whose omo.jsonc override lives
under a different config-key alias (e.g. `agents.scribe`, bound to the runtime
name via `prompt_append: "file://./agents/technical-writer.md"` or
`displayName`), the lookup misses:

- no override model → `hasExplicitUserModel` false
- custom agents have no `AGENT_MODEL_REQUIREMENTS` entry and often no own
  `matchedAgent.model` → line 52 gate false → `categoryModel = undefined`
- `background-task.ts launch()` receives only `parentModel` → subagent inherits
  the parent session model (same for sync path).

Schema side already preserves custom keys (`AgentOverridesSchema.catchall`,
#3742). The remaining defect is resolver-side identity resolution.

## Change

1. `subagent-model-resolution.ts`:
   - Add `collectOverrideAliasNames(override)`: lowercased `displayName` +
     lowercased stem (basename minus extension) of a `file://` `prompt_append`
     URI (decodeURIComponent guarded, malformed URI skipped with log).
   - Extend `findAgentOverride(agentOverrides, agentToUse)`: direct/case-
     insensitive key hit first (unchanged), else reverse-alias scan matching
     `getAgentConfigKey(agentToUse)` against collected alias names; log when a
     reverse-alias match resolves.
2. Tests in existing
   `zauc-mocks-subagent-resolver/subagent-resolver-agent-overrides.test.ts`
   (given/when/then, same mock.module harness):
   - RED regression: runtime agent `technical-writer` (no own model), override
     under `scribe` keyed by `prompt_append` basename → expect categoryModel
     `{ providerID: "gitlab", modelID: "duo-chat-sonnet-4-6" }`.
   - RED regression 2: same via `displayName` binding.
   - Priority guard: exact config-key override still wins over alias match.
   - No-false-positive guard: unrelated prompt_append → categoryModel stays
     undefined (parent inheritance preserved).

## Verification

- Failing-first: run new tests against unmodified source → red capture.
- After fix: scoped suite green
  (`bun test packages/omo-opencode/src/tools/delegate-task/zauc-mocks-subagent-resolver/ --bail`
  plus neighboring delegate-task suites touched by the seam).
- Typecheck: tsgo scoped to packages/omo-opencode (LSP daemon unreliable in
  worktrees; tsgo authoritative).
- Evidence: `.omo/evidence/20260825-subagent-model-config-ignored/`
  (before-fix-red.txt, after-fix-green.txt, scoped-tests.txt, typecheck.txt,
  qa.md incl. honest omission notes for live-harness drive).

## Commit / PR

- One conventional commit staging ONLY: subagent-model-resolution.ts,
  subagent-resolver-agent-overrides.test.ts, plan file, evidence dir (-f).
- Push `fork issue/3228-subagent-model-config-ignored`; PR to
  code-yeongyu/oh-my-openagent `dev` from `AceRothstein71:<branch>`, English
  What/Why/Verified/Risk, ending `Fixes #3228`.

## Out of scope

- call_omo_agent path (explore/librarian builtin keys already resolve).
- senpi-task mirror of the resolver (separate adapter; issue is OpenCode-side).
