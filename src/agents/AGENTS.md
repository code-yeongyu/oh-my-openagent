# src/agents/ — 11 Agent Definitions

**Generated:** 2026-03-02

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
| **Sisyphus** | claude-opus-4-6 | 0.1 | all | kimi-k2.5 → glm-5 → big-pickle | Main orchestrator, plans + delegates |
| **Hephaestus** | gpt-5.3-codex | 0.1 | all | gpt-5.2 (copilot) | Autonomous deep worker |
| **Oracle** | gpt-5.2 | 0.1 | subagent | gemini-3.1-pro → claude-opus-4-6 | Read-only consultation |
| **Librarian** | kimi-k2.5 | 0.1 | subagent | gemini-3-flash → gpt-5.2 → glm-4.6v | External docs/code search |
| **Explore** | grok-code-fast-1 | 0.1 | subagent | minimax-m2.5 → claude-haiku-4-5 → gpt-5-nano | Contextual grep |
| **Multimodal-Looker** | gemini-3-flash | 0.1 | subagent | minimax-m2.5 → big-pickle | PDF/image analysis |
| **Metis** | claude-opus-4-6 | **0.3** | subagent | gpt-5.2 → kimi-k2.5 → gemini-3.1-pro | Pre-planning consultant |
| **Momus** | gpt-5.2 | 0.1 | subagent | claude-opus-4-6 → gemini-3.1-pro | Plan reviewer |
| **Coeus** | claude-opus-4-6 | 0.1 | subagent | kimi-k2.5 → gpt-5.2 → gemini-3-pro | Recursive divide-and-conquer planner |
| **Sub-Prometheus** | claude-sonnet-4-5 | 0.1 | subagent | gpt-5.2 → gemini-3-pro | Domain-specific sub-planner (spawned by Coeus) |
| **Atlas** | kimi-k2.5 | 0.1 | primary | claude-sonnet-4-6 → gpt-5.2 | Todo-list orchestrator |
| **Prometheus** | claude-opus-4-6 | 0.1 | — | kimi-k2.5 → gpt-5.2 → gemini-3.1-pro | Strategic planner (internal) |
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
