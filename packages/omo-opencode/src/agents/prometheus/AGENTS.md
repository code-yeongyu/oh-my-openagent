---
name: prometheus-agent
description: Developer reference for the Prometheus strategic planner agent thin prompt adapter and ulw-plan skill dependency.
---

# src/agents/prometheus/ -- Strategic Planner

**Generated:** 2026-05-24 | **Updated:** 2026-06-15 (single thin prompt)

## OVERVIEW

Prometheus is the interview-mode strategic planner. This directory is a thin OpenCode adapter over one harness-neutral prompt asset:
[`packages/prompts-core/prompts/prometheus/default.md`](../../../../prompts-core/prompts/prometheus/default.md).

The prompt is intentionally small. It identifies Prometheus as the planner, keeps plan mode sticky, and requires the path-backed [`ulw-plan`](../../../../shared-skills/skills/ulw-plan/SKILL.md) skill for the planning mechanics: exploration, clear/unclear intent routing, approval gate, plan scaffold, review flow, and final `.omo` plan output.

This shape follows the package layering refactor in [`ROADMAP.md`](../../../../../ROADMAP.md): prompts are harness-neutral core assets, shared planning behavior lives in the skill layer, and the OpenCode adapter keeps only runtime integration.

## FILES

| File | Purpose |
|------|---------|
| `index.ts` | Barrel exports |
| `system-prompt.ts` | Thin loader using `loadPromptSync()` from `@oh-my-opencode/prompts-core`; `getPrometheusPrompt()` always loads the same `default.md` prompt body |
| `system-prompt.test.ts` | Runtime behavior tests for the single-prompt loader contract |
| `packages/prompts-core/prompts/prometheus/default.md` | The single Prometheus markdown prompt asset |
| `packages/shared-skills/skills/ulw-plan/SKILL.md` | Path-backed skill containing the full planning workflow |

## PROMPT LOADING

`getPrometheusPrompt(model, disabledTools)` ignores model family for prompt selection and always loads `packages/prompts-core/prompts/prometheus/default.md`. The `model` parameter is accepted for compatibility with the agent config path, but it does not choose different prompt text.

Keep prompt edits in `default.md`. Do not add model-specific markdown files, copied prompt bodies, or adapter-side routing. If the planning workflow changes, update the `ulw-plan` skill and its references rather than expanding the Prometheus prompt.

## ULW-PLAN DEPENDENCY

The prompt requires Prometheus to load `ulw-plan` as its first action with the skill tool. The skill is the source of truth for:

- Explore-first planning and when to ask the user
- Clear versus unclear intent routing
- Approval-gated plan generation
- Plan/draft scaffold creation under `.omo/`
- High-accuracy review expectations
- Worker-ready task graphs and verification criteria

Prometheus itself stays a planner. It reads, searches, and writes planning artifacts only; implementation belongs to downstream workers after explicit start-work approval.

## KEY CONSTRAINTS

- May ONLY create/edit `.md` files (enforced by hook)
- FORBIDDEN paths: `src/`, `package.json`, config files
- Must explore codebase before planning (NEVER plan blind)
- Plans saved to `.omo/plans/`
- Acceptance criteria requiring "user manually tests" are FORBIDDEN
- Prompt edits belong in [`packages/prompts-core/prompts/prometheus/default.md`](../../../../prompts-core/prompts/prometheus/default.md), not in TypeScript section files
- Planning mechanics belong in the path-backed [`ulw-plan`](../../../../shared-skills/skills/ulw-plan/SKILL.md) skill

## PLAN OUTPUT FORMAT

The `ulw-plan` skill instructs Prometheus to produce `.omo` markdown plans with a parallel task graph:

- Waves (parallel execution groups)
- Tasks with dependencies, category, skills
- Each task has atomic scope + verification criteria
