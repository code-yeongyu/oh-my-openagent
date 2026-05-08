---
name: agents-directory
description: Developer reference for all 11 Oh My OpenAgent agent definitions, factory patterns, tool restrictions, and model routing.
---

# src/agents/ — 11 Agent Definitions

**Generated:** 2026-05-08

## OVERVIEW

Agent factories follow `createXXXAgent(model) → AgentConfig` pattern. Each has static `mode` property. Built via `buildAgent()` compositing factory + categories + skills. Built-in agent registry: [`builtin-agents.ts`](file:///Users/yeongyu/local-workspaces/omo/src/agents/builtin-agents.ts) `agentSources`. Type definition: [`types.ts`](file:///Users/yeongyu/local-workspaces/omo/src/agents/types.ts) `BuiltinAgentName` (10 names + sisyphus-junior derived = 11 distinct agents).

## AGENT INVENTORY

| Agent | Model | Temp | Mode | Fallback Chain (top of) | Purpose |
|-------|-------|------|------|--------------------------|---------|
| **Sisyphus** | claude-opus-4-7 max | 0.1 | all | k2p5 → kimi-k2.6 → gpt-5.5 medium → glm-5 → big-pickle | Main orchestrator, plans + delegates |
| **Hephaestus** | gpt-5.5 medium | 0.1 | all | (GPT-only) | Autonomous deep worker — "Legitimate Craftsman" |
| **Oracle** | gpt-5.5 high | 0.1 | subagent | gemini-3.1-pro high → claude-opus-4-7 max → glm-5.1 | Read-only consultation |
| **Librarian** | gpt-5.4-mini-fast | 0.1 | subagent | qwen3.5-plus → minimax-m2.7-highspeed → claude-haiku-4-5 → gpt-5.4-nano | External docs/code search |
| **Explore** | gpt-5.4-mini-fast | 0.1 | subagent | qwen3.5-plus → minimax-m2.7-highspeed → claude-haiku-4-5 → gpt-5.4-nano | Contextual grep |
| **Multimodal-Looker** | gpt-5.5 medium | 0.1 | subagent | kimi-k2.6 → glm-4.6v → gpt-5-nano | PDF/image analysis |
| **Metis** | claude-opus-4-7 max | **0.3** | subagent | gpt-5.5 high → gemini-3.1-pro high → glm-5.1 → k2p5 | Pre-planning consultant |
| **Momus** | gpt-5.5 xhigh | 0.1 | subagent | claude-opus-4-7 max → gemini-3.1-pro high → glm-5.1 | Plan reviewer |
| **Atlas** | claude-sonnet-4-6 | 0.1 | primary | kimi-k2.6 → gpt-5.5 medium → minimax-m2.7 | Todo-list orchestrator |
| **Prometheus** | claude-opus-4-7 max | 0.1 | primary | gpt-5.5 high → glm-5.1 → gemini-3.1-pro | Strategic planner (interview) |
| **Sisyphus-Junior** | claude-sonnet-4-6 | 0.1 | all | user-configurable | Category-spawned executor |

Authoritative chains live in [`src/shared/model-requirements.ts`](file:///Users/yeongyu/local-workspaces/omo/src/shared/model-requirements.ts).

## TOOL RESTRICTIONS

Defined in [`src/shared/agent-tool-restrictions.ts`](file:///Users/yeongyu/local-workspaces/omo/src/shared/agent-tool-restrictions.ts).

| Agent | Denied Tools |
|-------|-------------|
| Oracle | write, edit, task, call_omo_agent |
| Librarian | write, edit, task, call_omo_agent |
| Explore | write, edit, task, call_omo_agent |
| Multimodal-Looker | ALL except read |
| Atlas | task, call_omo_agent |
| Momus | write, edit, task |
| Prometheus | enforces `.md`-only writes via `prometheus-md-only` hook (path-based, not tool-based) |

## TEAM-MODE ELIGIBILITY

Only **sisyphus, atlas, sisyphus-junior, hephaestus** can be team members. Read-only agents (oracle, librarian, explore, multimodal-looker, metis, momus, prometheus) are rejected at TeamSpec parse. See [`team-mode/AGENTS.md`](file:///Users/yeongyu/local-workspaces/omo/src/features/team-mode/AGENTS.md).

## STRUCTURE

```
agents/
├── sisyphus.ts                                # Main orchestrator router
├── sisyphus/                                  # Model-specific variant prompts
│   ├── default.ts, gemini.ts, gpt-5-4.ts, gpt-5-5.ts
├── hephaestus.ts                              # Routes to model variant
├── hephaestus/                                # gpt.ts, gpt-5-3-codex.ts, gpt-5-4.ts, gpt-5-5.ts
├── oracle.ts                                  # Read-only consultant
├── librarian.ts                               # External search
├── explore.ts                                 # Codebase grep
├── multimodal-looker.ts                       # Vision/PDF
├── metis.ts                                   # Pre-planning
├── momus.ts                                   # Plan review
├── atlas/agent.ts                             # Todo orchestrator
├── prometheus/                                # Strategic planner — system-prompt.ts, identity-constraints.ts, interview-mode.ts, plan-template.ts, gemini.ts, gpt.ts
├── types.ts                                   # BuiltinAgentName, AgentMode, AgentConfig
├── builtin-agents.ts                          # agentSources registry (10 → 11 with sisyphus-junior)
├── builtin-agents/                            # maybeCreateXXXConfig conditional factories + general-agents.ts + available-skills.ts
├── agent-builder.ts                           # buildAgent() composition
├── utils.ts                                   # agent utilities
├── env-context.ts                             # environment context for prompts
├── custom-agent-summaries.ts                  # custom-agent prompt summaries
├── dynamic-agent-prompt-builder.ts            # dynamic prompt builder
├── dynamic-agent-core-sections.ts             # core prompt sections
├── dynamic-agent-policy-sections.ts           # policy sections
├── dynamic-agent-tool-categorization.ts       # tool categorization for prompt
└── dynamic-agent-category-skills-guide.ts     # category-skill guidance
```

## FACTORY PATTERN

```typescript
const createXXXAgent: AgentFactory = (model: string) => ({
  instructions: "...",
  model,
  temperature: 0.1,
  // ...config
})
createXXXAgent.mode = "subagent" // or "primary" or "all"
```

Model resolution: 4-step pipeline → override → category-default → provider-fallback → system-default. Defined in [`shared/model-resolution-pipeline.ts`](file:///Users/yeongyu/local-workspaces/omo/src/shared/model-resolution-pipeline.ts).

## MODES

- **`primary`** — respects UI-selected model, uses fallback chain (Atlas, Prometheus)
- **`subagent`** — uses own fallback chain, ignores UI selection (Oracle, Librarian, Explore, etc.)
- **`all`** — available in both contexts (Sisyphus, Hephaestus, Sisyphus-Junior)

## CANONICAL ORDER

`Sisyphus → Hephaestus → Prometheus → Atlas` (primary core agents) then alphabetical for the rest. Enforced by [`installAgentSortShim()`](file:///Users/yeongyu/local-workspaces/omo/src/shared/agent-sort-shim.ts) — patches `Array.prototype.{toSorted,sort}` narrowly when ≥2 canonical core agents are in the array. See [`src/plugin-handlers/AGENTS.md`](file:///Users/yeongyu/local-workspaces/omo/src/plugin-handlers/AGENTS.md) for the full history.

## DYNAMIC PROMPT BUILDER

`dynamic-agent-prompt-builder.ts` composes per-agent system prompts at runtime by stitching:
- Core sections (identity, mode, restrictions)
- Policy sections (citation, verification, anti-patterns)
- Tool categorization (per-domain tool guidance)
- Category-skills guide (which skills load with which categories)

This is what the Sisyphus prompt's "AGENTS / CATEGORY + SKILLS" tables come from.
