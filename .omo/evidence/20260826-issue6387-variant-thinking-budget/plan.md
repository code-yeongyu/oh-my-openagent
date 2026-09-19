# Plan: issue #6387 - Claude models ignore `variant` for thinking budget

## Root cause (traced, not from memory)

`buildClaudeThinkingConfig(model)` in `packages/omo-opencode/src/agents/types.ts` (line 50)
emits `{ thinking: { type: "enabled", budgetTokens: 32000 } }` for every Claude model on the
manual enabled-thinking path (everything except Opus 4.7+/Fable/Mythos, which return `{}` and
let OpenCode core drive adaptive thinking). The function only receives `model`; the resolved
`variant` is merged onto the AgentConfig AFTER the factory ran:

- general-agents.ts:106-119 (resolvedVariant applied, then applyOverrides)
- sisyphus-agent.ts:81-96 (same)
- atlas-agent.ts:63-76 (same)
- hephaestus-agent.ts:80-116 (variant applied; GPT-only agent, emits no thinking -> out of scope)
- agent-config-assembly.ts:131 (sisyphus-junior built directly from override; reads
  override.variant itself at sisyphus-junior/agent.ts:159-161)

Call sites of buildClaudeThinkingConfig: metis.ts:408, momus.ts:319, oracle.ts:458,
sisyphus-agent-config.ts:75, sisyphus-junior/agent.ts:173.

Payload path: AgentConfig.thinking is seeded by OpenCode core into chat.params
`output.options.thinking` (consumed by packages/omo-opencode/src/plugin/chat-params.ts:131,
passed through untouched by resolveCompatibleModelSettings in model-core), so scaling the
config-build value fixes both persisted session metadata and the outgoing Anthropic request.
GPT models are unaffected because their variant reaches the API natively via
reasoningEffort/variant (applyAgentVariant + chat.params).

## Fix (minimal, root-cause)

1. `packages/omo-opencode/src/agents/types.ts`
   - Add exported `CLAUDE_THINKING_BUDGET_BY_VARIANT` ladder:
     minimal 4096, low 8192, medium 16000, high 32000 (= legacy default),
     xhigh 48000, max 60000.
     - max = 60000, NOT the reporter's suggested 64000: Anthropic requires
       budget_tokens < max_tokens; sisyphus/sisyphus-junior set maxTokens 64000 and core
       output defaults are commonly 64k, so 64000 risks a hard API 400. 60000 stays strictly
       below both.
   - Add exported `resolveClaudeThinkingBudget(variant: string | undefined): number`
     (case-insensitive lookup; off/unknown/undefined -> 32000 legacy default).
   - `buildClaudeThinkingConfig(model, variant?)` uses the resolver; existing call sites
     that pass no variant keep byte-identical behavior.
2. `packages/omo-opencode/src/agents/builtin-agents/agent-overrides.ts`
   - New `applyVariantDerivedThinkingBudget(config, categoryConfig, override)` invoked at the
     end of `applyOverrides()` where the FINAL resolved variant is available. Guards:
     thinking is a record with type === "enabled" (manual path only);
     category did not set explicit thinking; direct override did not set explicit thinking
     (user budgetTokens always win); returns input untouched when derived budget equals the
     current one (no-op for every existing no-variant config).
3. `packages/omo-opencode/src/agents/sisyphus-junior/agent.ts`
   - Pass `base.variant` into `buildClaudeThinkingConfig(model, base.variant)` so the
     category-spawned executor path (which bypasses applyOverrides) scales too.

Out of scope (documented): prometheus builder emits thinking only from explicit user/category
config (no hardcoded default to scale); runtime-fallback mid-session model switches;
per-message TUI variant overrides (request-time re-derivation would be a second, larger fix).

## TDD

RED first (saved log): types.test.ts resolver cases + agent-overrides.test.ts applyOverrides
re-derivation cases + sisyphus-junior variant pass-through case must FAIL on current code.
Then GREEN with the minimal edits above. given/when/then style, no as any / ts-ignore /
ts-expect-error / non-null assertions.

## Gates (twice consecutively over final tree)

- bun test packages/omo-opencode/src/agents (+ touched-area tests)
- bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json
- GIT_MASTER=1 git diff --check
- hygiene scan: as any / @ts-ignore / @ts-expect-error / non-null assertion additions

## QA (isolated under /tmp/opencode/issue-6387/)

Integration fakes importing the real modules: different variants produce different budgets
through applyOverrides AND through createSisyphusJuniorAgentWithOverrides; GPT/GLM configs
carry no scaled thinking block; explicit user thinking wins over variant. No real
~/.config/opencode access; nothing spawns opencode.

## Self-audit

Numbered waves over the ENTIRE vertical (types.ts, agent-overrides.ts, all 5 call sites,
hephaestus/atlas/prometheus paths, chat-params passthrough, model-core compatibility layer,
docs mentioning 32000). Ledger P0-P3 + noise. Any edit resets clean_streak=0. Stop after two
consecutive post-final-edit zero-finding waves.
