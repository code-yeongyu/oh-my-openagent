---
name: prometheus-agent
description: Developer reference for the Prometheus strategic planner agent prompt loaders, prompts-core markdown variants, and model routing.
---

# src/agents/prometheus/ -- Strategic Planner

**Generated:** 2026-05-24 | **Updated:** 2026-06-11 (Claude per-model variants)

## OVERVIEW

3 TypeScript files plus 7 markdown prompt variants in [`packages/prompts-core/prompts/prometheus/`](../../../../prompts-core/prompts/prometheus). Prometheus remains the interview-mode strategic planner, but this directory is now a thin adapter layer. Prompt content lives in `packages/prompts-core`; `src/agents/prometheus/` routes model variants and applies runtime tool gating.

This shape follows the package layering refactor in [`ROADMAP.md`](../../../../../ROADMAP.md): prompts are harness-neutral core assets, while the OpenCode adapter keeps only model routing and runtime integration.

## FILES

| File | Purpose |
|------|---------|
| `index.ts` | Barrel exports |
| `system-prompt.ts` | Thin loader using `loadPromptSync()` and `prometheusPromptVariants` from `@oh-my-opencode/prompts-core`; exports prompt source routing and disabled-tool filtering |
| `system-prompt.test.ts` | Runtime behavior tests for Question tool filtering |
| `packages/prompts-core/prompts/prometheus/default.md` | Default/Claude markdown prompt variant |
| `packages/prompts-core/prompts/prometheus/claude-fable-5.md` | Claude Fable 5 variant (default + Fable `<self_knowledge>` tuning block) |
| `packages/prompts-core/prompts/prometheus/claude-opus-4-8.md` | Claude Opus 4.8 variant (default + 4.8 `<self_knowledge>` tuning block) |
| `packages/prompts-core/prompts/prometheus/claude-opus-4-7.md` | Claude Opus 4.7 variant (default + 4.7 `<self_knowledge>` tuning block) |
| `packages/prompts-core/prompts/prometheus/claude-opus-4-6.md` | Claude Opus 4.6 variant (default + 4.6 `<self_knowledge>` tuning block) |
| `packages/prompts-core/prompts/prometheus/gpt.md` | GPT-optimized markdown prompt variant |
| `packages/prompts-core/prompts/prometheus/gemini.md` | Gemini-optimized markdown prompt variant |

## MODEL VARIANT ROUTING

[`system-prompt.ts`](system-prompt.ts) exposes `getPrometheusPromptSource(model)` (checked in this order):

- Claude Fable 5 (`isClaudeFable5Model`) routes to `"claude-fable-5"`.
- Claude Opus 4.8 (`isClaudeOpus48Model`) routes to `"claude-opus-4-8"`.
- Claude Opus 4.7 (`isClaudeOpus47Model`) routes to `"claude-opus-4-7"`.
- Claude Opus 4.6 (`isClaudeOpus46Model`) routes to `"claude-opus-4-6"`.
- GPT family models, as detected by `isGptModel(model)`, route to `"gpt"`.
- Gemini family models, as detected by `isGeminiModel(model)`, route to `"gemini"`.
- Missing models and all other families (including Sonnet/Haiku) route to `"default"`.

`getPrometheusPrompt(model, disabledTools)` then loads the selected markdown through `loadPromptSync({ source: prometheusPromptVariants[variant], name: "prometheus", variant })` and returns the loaded body.

## CLAUDE PER-MODEL TUNING (design principles)

The four Claude variants are byte-copies of `default.md` plus ONE inserted `<self_knowledge>` block after the Prometheus identity paragraph (same pattern as the Sisyphus per-model variants in [`src/agents/sisyphus/`](../sisyphus)). Principles are distilled from the Anthropic per-model prompting guides:

| Variant | Defaults countered |
|---------|--------------------|
| `claude-opus-4-6` | Over-exploration (bound to one 2-3 agent wave per question), subagent overuse (distinct angle per dispatch), overengineered plans (extras go to Must NOT Have), premature context-budget wrap-up |
| `claude-opus-4-7` | Research under-triggering (favors recall over tool calls — fire explore/librarian), subagent under-spawning (dispatch full wave in one response), literal instruction following (plans must state scope explicitly), bounded exploration (one wave per question) |
| `claude-opus-4-8` | 4.7 set, plus capability under-reach (dispatch NOW, no "worth it" debate), over-asking the user (research first, then ask the informed question), narration (lean interview turns) |
| `claude-fable-5` | DELEGATED DISCOVERY MANDATE (Fable never greps/reads source itself — every discovery question becomes an explore/librarian dispatch), wide fan-out (3-6 agents per wave, one angle each), follow-up waves on gaps, stay async (never block on a wave), grounded claims only, no overplanning |

When editing `default.md`, replicate content changes into the four Claude variants (only the `<self_knowledge>` block may differ). Behavior coverage (variant routing, tuning-block inclusion/exclusion, Question-tool stripping) lives in `system-prompt.test.ts`.

## DISABLED TOOL HANDLING

Prometheus normally includes `Question({ ... })` examples because interview mode uses the Question tool to clarify scope. When the runtime passes `disabledTools` containing `"question"`, `getPrometheusPrompt()` strips fenced TypeScript `Question({ ... })` examples with `QUESTION_TOOL_BLOCK_RE` before returning the prompt.

This filtering is runtime adapter behavior. Do not duplicate stripped markdown variants in `packages/prompts-core`; keep one source of truth per model family and let `system-prompt.ts` remove Question examples only when the tool is disabled.

## KEY CONSTRAINTS

- May ONLY create/edit `.md` files (enforced by hook)
- FORBIDDEN paths: `src/`, `package.json`, config files
- Must explore codebase before planning (NEVER plan blind)
- Plans saved to `.omo/plans/`
- Acceptance criteria requiring "user manually tests" are FORBIDDEN
- Prompt edits belong in [`packages/prompts-core/prompts/prometheus/`](../../../../prompts-core/prompts/prometheus), not in TypeScript section files

## PLAN OUTPUT FORMAT

The markdown variants instruct Prometheus to produce YAML plans with a parallel task graph:

- Waves (parallel execution groups)
- Tasks with dependencies, category, skills
- Each task has atomic scope + verification criteria
