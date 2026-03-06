# src/agents/ — 11 Agent Definitions

**Generated:** 2026-03-06

## OVERVIEW

13 AI agents with factory functions, fallback chains, and model-specific prompt variants. Each agent has metadata (category, cost, triggers) and configurable tool restrictions.

## STRUCTURE
```
agents/
├── sisyphus.ts                 # Main orchestrator (559 lines)
├── hephaestus.ts               # Autonomous deep worker (651 lines)
├── oracle.ts                   # Strategic advisor (171 lines)
├── librarian.ts                # Multi-repo research (329 lines)
├── explore.ts                  # Fast codebase grep (125 lines)
├── multimodal-looker.ts        # Media analyzer (59 lines)
├── metis.ts                    # Pre-planning analysis (347 lines)
├── momus.ts                    # Plan validator (244 lines)
├── coeus/                      # Recursive planner (14 files) — see coeus/AGENTS.md
├── sub-prometheus.ts           # Domain-specific sub-planner (spawned by Coeus)
├── atlas/                      # Master orchestrator (agent.ts + default.ts + gpt.ts)
├── prometheus/                 # Planning agent (8 files, plan-template 423 lines)
├── sisyphus-junior/            # Delegated task executor (agent.ts + default.ts + gpt.ts)
├── dynamic-agent-prompt-builder.ts  # Dynamic prompt generation (433 lines)
├── builtin-agents/             # Agent registry + model resolution
├── agent-builder.ts            # Agent construction with category merging (51 lines)
├── utils.ts                    # Agent creation, model fallback resolution (571 lines)
├── types.ts                    # AgentModelConfig, AgentPromptMetadata (106 lines)
└── index.ts                    # Exports
```

| Agent | Model | Temp | Mode | Fallback Chain | Purpose |
|-------|-------|------|------|----------------|---------|
| **Sisyphus** | claude-opus-4-6 max | 0.1 | all | glm-5 → big-pickle | Main orchestrator, plans + delegates |
| **Hephaestus** | gpt-5.3-codex medium | 0.1 | all | gpt-5.2 medium (copilot) | Autonomous deep worker |
| **Oracle** | gpt-5.2 high | 0.1 | subagent | gemini-3.1-pro high → claude-opus-4-6 max | Read-only consultation |
| **Librarian** | gemini-3-flash | 0.1 | subagent | minimax-m2.5-free → big-pickle | External docs/code search |
| **Explore** | grok-code-fast-1 | 0.1 | subagent | minimax-m2.5-free → claude-haiku-4-5 → gpt-5-nano | Contextual grep |
| **Multimodal-Looker** | gpt-5.3-codex medium | 0.1 | subagent | k2p5 → gemini-3-flash → glm-4.6v → gpt-5-nano | PDF/image analysis |
| **Metis** | claude-opus-4-6 max | **0.3** | subagent | gpt-5.2 high → gemini-3.1-pro high | Pre-planning consultant |
| **Momus** | gpt-5.4 xhigh | 0.1 | subagent | claude-opus-4-6 max → gemini-3.1-pro high | Plan reviewer |
| **Coeus** | claude-opus-4-6 max | 0.1 | subagent | kimi-k2.5-free → gpt-5.2 high → gemini-3.1-pro | Recursive divide-and-conquer planner |
| **Sub-Prometheus** | claude-sonnet-4-6 | 0.1 | subagent | gpt-5.2 high → gemini-3.1-pro | Domain-specific sub-planner (spawned by Coeus) |
| **Atlas** | claude-sonnet-4-6 | 0.1 | primary | gpt-5.4 medium | Todo-list orchestrator |
| **Prometheus** | claude-opus-4-6 max | 0.1 | — | gpt-5.4 high → gemini-3.1-pro | Strategic planner (internal) |
| **Sisyphus-Junior** | claude-sonnet-4-6 | 0.1 | all | user-configurable | Category-spawned executor |

## TOOL RESTRICTIONS

| Agent | Denied | Allowed |
|-------|--------|---------|
| oracle | write, edit, task, call_omo_agent | Read-only consultation |
| librarian | write, edit, task, call_omo_agent | Research tools only |
| explore | write, edit, task, call_omo_agent | Search tools only |
| multimodal-looker | ALL except `read` | Vision-only |
| Sisyphus-Junior | task | No delegation |
| Atlas | task, call_omo_agent | Orchestration only |
| Coeus | write, edit | Read-only planner (no file writes) |
| Sub-Prometheus | write, edit | Domain sub-planner (no file writes) |

## THINKING / REASONING

| Agent | Claude | GPT |
|-------|--------|-----|
| Sisyphus | 32k budget tokens | reasoningEffort: "medium" |
| Hephaestus | — | reasoningEffort: "medium" |
| Oracle | 32k budget tokens | reasoningEffort: "medium" |
| Metis | 32k budget tokens | — |
| Momus | 32k budget tokens | reasoningEffort: "medium" |
| Sisyphus-Junior | 32k budget tokens | reasoningEffort: "medium" |

## KEY PROMPT PATTERNS

- **Sisyphus/Hephaestus**: Dynamic prompts via `dynamic-agent-prompt-builder.ts` injecting available tools/skills/categories
- **Atlas, Sisyphus-Junior**: Model-specific prompts (Claude vs GPT variants)
- **Prometheus**: 6-section modular prompt (identity → interview → plan-generation → high-accuracy → template → behavioral)
- **Coeus**: 6-phase system prompt (assess → decompose → spawn → validate → merge → output)

Model resolution: 4-step: override → category-default → provider-fallback → system-default. Defined in `shared/model-requirements.ts`.

## HOW TO ADD

1. Create `src/agents/my-agent.ts` exporting factory + metadata
2. Add to `agentSources` in `src/agents/builtin-agents/`
3. Update `AgentNameSchema` in `src/config/schema/agent-names.ts`
4. Register in `src/plugin-handlers/agent-config-handler.ts`

## ANTI-PATTERNS

- **Trust agent self-reports**: NEVER — always verify outputs
- **High temperature**: Don't use >0.3 for code agents
- **Sequential calls**: Use `task` with `run_in_background` for exploration
- **Prometheus writing code**: Planner only — never implements
