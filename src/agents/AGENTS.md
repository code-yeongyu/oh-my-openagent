# AGENTS KNOWLEDGE BASE

## OVERVIEW

11 AI agents with factory functions, fallback chains, and model-specific prompt variants. Each agent has metadata (category, cost, triggers) and configurable tool restrictions.

## STRUCTURE
```
agents/
├── sisyphus.ts                 # Main orchestrator (530 lines)
├── hephaestus.ts               # Autonomous deep worker (624 lines)
├── oracle.ts                   # Strategic advisor (170 lines)
├── librarian.ts                # Multi-repo research (328 lines)
├── explore.ts                  # Fast codebase grep (124 lines)
├── multimodal-looker.ts        # Media analyzer (58 lines)
├── metis.ts                    # Pre-planning analysis (347 lines)
├── momus.ts                    # Plan validator (244 lines)
├── atlas/                      # Master orchestrator
│   ├── agent.ts                # Atlas factory
│   ├── default.ts              # Claude-optimized prompt
│   ├── gpt.ts                  # GPT-optimized prompt
│   └── utils.ts
├── prometheus/                 # Planning agent
│   ├── index.ts
│   ├── system-prompt.ts        # 6-section prompt assembly
│   ├── plan-template.ts        # Work plan structure (423 lines)
│   ├── interview-mode.ts       # Interview flow (335 lines)
│   ├── plan-generation.ts
│   ├── high-accuracy-mode.ts
│   ├── identity-constraints.ts # Identity rules (301 lines)
│   └── behavioral-summary.ts
├── sisyphus-junior/            # Delegated task executor
│   ├── agent.ts
│   ├── default.ts              # Claude prompt
│   └── gpt.ts                  # GPT prompt
├── dynamic-agent-prompt-builder.ts  # Dynamic prompt generation (431 lines)
├── builtin-agents/             # Agent registry (8 files)
├── utils.ts                    # Agent creation, model fallback resolution (571 lines)
├── types.ts                    # AgentModelConfig, AgentPromptMetadata
└── index.ts                    # Exports
```

## AGENT MODELS

| Agent | Model | Temp | Fallback Chain | Cost |
|-------|-------|------|----------------|------|
| Sisyphus | claude-opus-4-6 | 0.1 | kimi-k2.5 → glm-4.7 → gpt-5.3-codex → gemini-3-pro | EXPENSIVE |
| Hephaestus | gpt-5.3-codex | 0.1 | NONE (required) | EXPENSIVE |
| Atlas | claude-sonnet-4-5 | 0.1 | kimi-k2.5 → gpt-5.2 | EXPENSIVE |
| Prometheus | claude-opus-4-6 | 0.1 | kimi-k2.5 → gpt-5.2 | EXPENSIVE |
| oracle | gpt-5.2 | 0.1 | claude-opus-4-6 | EXPENSIVE |
| librarian | glm-4.7 | 0.1 | glm-4.7-free | CHEAP |
| explore | grok-code-fast-1 | 0.1 | claude-haiku-4-5 → gpt-5-mini → gpt-5-nano | FREE |
| multimodal-looker | gemini-3-flash | 0.1 | NONE | CHEAP |
| Metis | claude-opus-4-6 | 0.3 | kimi-k2.5 → gpt-5.2 | EXPENSIVE |
| Momus | gpt-5.2 | 0.1 | claude-opus-4-6 | EXPENSIVE |
| Sisyphus-Junior | claude-sonnet-4-5 | 0.1 | (user-configurable) | EXPENSIVE |

## TOOL RESTRICTIONS

| Agent | Denied | Allowed |
|-------|--------|---------|
| oracle | write, edit, task, call_omo_agent | Read-only consultation |
| librarian | write, edit, task, call_omo_agent | Research tools only |
| explore | write, edit, task, call_omo_agent | Search tools only |
| multimodal-looker | ALL except `read` | Vision-only |
| Sisyphus-Junior | task | No delegation |
| Atlas | task, call_omo_agent | Orchestration only |

## THINKING / REASONING

| Agent | Claude | GPT |
|-------|--------|-----|
| Sisyphus | 32k budget tokens | reasoningEffort: "medium" |
| Hephaestus | — | reasoningEffort: "medium" |
| Oracle | 32k budget tokens | reasoningEffort: "medium" |
| Metis | 32k budget tokens | — |
| Momus | 32k budget tokens | reasoningEffort: "medium" |
| Sisyphus-Junior | 32k budget tokens | reasoningEffort: "medium" |

## HOW TO ADD

1. Create `src/agents/my-agent.ts` exporting factory + metadata
2. Add to `agentSources` in `src/agents/builtin-agents/`
3. Update `AgentNameSchema` in `src/config/schema/agent-names.ts`
4. Register in `src/plugin-handlers/agent-config-handler.ts`

## KEY PATTERNS

- **Factory**: `createXXXAgent(model): AgentConfig`
- **Metadata**: `XXX_PROMPT_METADATA` with category, cost, triggers
- **Model-specific prompts**: Atlas, Sisyphus-Junior have GPT vs Claude variants
- **Dynamic prompts**: Sisyphus, Hephaestus use `dynamic-agent-prompt-builder.ts` to inject available tools/skills/categories

## ANTI-PATTERNS

- **Trust agent self-reports**: NEVER — always verify outputs
- **High temperature**: Don't use >0.3 for code agents
- **Sequential calls**: Use `task` with `run_in_background` for exploration
- **Prometheus writing code**: Planner only — never implements
