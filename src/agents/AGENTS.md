# AGENTS KNOWLEDGE BASE

## OVERVIEW

14 AI agents with factory functions, fallback chains, and model-specific prompt variants. Each agent has metadata (category, cost, triggers) and configurable tool restrictions.

## STRUCTURE
```
agents/
├── morpheus.ts                 # Main orchestrator (530 lines)
├── keymaker.ts               # Autonomous deep worker (624 lines)
├── seraph.ts                    # Pre-planning analysis (347 lines)
├── oracle/                     # Strategic advisor / Planner
│   ├── index.ts
│   ├── system-prompt.ts        # 6-section prompt assembly
│   ├── plan-template.ts        # Work plan structure (423 lines)
│   ├── interview-mode.ts       # Interview flow (335 lines)
│   ├── plan-generation.ts
│   ├── high-accuracy-mode.ts
│   ├── identity-constraints.ts # Identity rules (301 lines)
│   └── behavioral-summary.ts
├── architect/                      # Master orchestrator
│   ├── agent.ts                # Architect factory
│   ├── default.ts              # Claude-optimized prompt
│   ├── gpt.ts                  # GPT-optimized prompt
│   └── index.ts
├── cipher.ts                    # DSL engineering specialist
├── sentinel.ts                 # Security auditor (220 lines)
├── merovingian.ts              # High-IQ consultation
├── smith.ts                    # Plan validator (244 lines)
├── construct.ts        # Media analyzer (58 lines)
├── sati.ts                     # Frontend specialist
├── trinity.ts                  # Codebase search
├── operator.ts                 # Library research
├── mouse/            # Delegated task executor
│   ├── agent.ts
│   ├── default.ts              # Claude prompt
│   ├── gpt.ts                  # GPT prompt
│   └── index.ts
├── agent-builder.ts            # Agent builder utility
├── dynamic-agent-prompt-builder.ts  # Dynamic prompt generation (431 lines)
├── builtin-agents/             # Agent registry (10 files)
├── utils.ts                    # Agent creation, model fallback resolution (571 lines)
├── types.ts                    # AgentModelConfig, AgentPromptMetadata
└── index.ts                    # Exports
```

## AGENT MODELS

| Agent | Model | Temp | Fallback Chain | Cost |
|-------|-------|------|----------------|------|
| Morpheus | claude-opus-4-6 | 0.1 | kimi-k2.5-free → glm-5 → big-pickle | EXPENSIVE |
| Keymaker | gpt-5.3-codex | 0.1 | gpt-5.2 (requires openai/github-copilot/venice/opencode) | EXPENSIVE |
| Seraph | claude-opus-4-6 | 0.3 | kimi-k2.5-free → gpt-5.2 → gemini-3.1-pro | EXPENSIVE |
| Oracle | claude-opus-4-6 | 0.1 | gpt-5.2 → kimi-k2.5-free → gemini-3.1-pro | EXPENSIVE |
| Architect | claude-sonnet-4-6 | 0.1 | claude-sonnet-4-6 → gpt-5.2 | EXPENSIVE |
| Cipher | claude-sonnet-4-6 | 0.1 | claude-opus-4-6@default → gpt-5.2 → kimi-k2.5-free → gemini-3.1-pro | EXPENSIVE |
| Sentinel | claude-sonnet-4-6 | 0.1 | claude-opus-4-6@default → gpt-5.2 → kimi-k2.5-free → gemini-3.1-pro | EXPENSIVE |
| Merovingian | claude-sonnet-4-6 | 0.1 | gemini-3.1-pro → claude-opus-4-6 | EXPENSIVE |
| Smith | claude-sonnet-4-6 | 0.1 | claude-opus-4-6 → gemini-3.1-pro | EXPENSIVE |
| Construct | claude-sonnet-4-6 | 0.1 | gemini-3-flash → gpt-5.2 → glm-4.6v → gpt-5-nano | EXPENSIVE |
| Sati | claude-sonnet-4-6 | 0.1 | claude-sonnet-4-6 → claude-opus-4-6@max | EXPENSIVE |
| Mouse | claude-sonnet-4-6 | 0.1 | (user-configurable) | EXPENSIVE |
| Trinity | claude-haiku-4-5 | 0.1 | minimax-m2.5-free → claude-haiku-4-5 → gpt-5-nano | CHEAP |
| Operator | claude-haiku-4-5 | 0.1 | glm-4.7-free → minimax-m2.5-free → claude-sonnet-4-6 | CHEAP |

## TOOL RESTRICTIONS

| Agent | Denied | Allowed |
|-------|--------|---------|
| Merovingian | write, edit, task, delegate_agent | Read-only consultation |
| Operator | write, edit, task, delegate_agent | Research tools only |
| Trinity | write, edit, task, delegate_agent | Search tools only |
| Construct | ALL except `read` | Vision-only |
| Mouse | task | No delegation |
| Architect | task, delegate_agent | Orchestration only |
| Sentinel | write, edit, multiedit, task, delegate_agent | Read-only security auditing |

## THINKING / REASONING

| Agent | Claude | GPT |
|-------|--------|-----|
| Morpheus | 32k budget tokens | reasoningEffort: "medium" |
| Keymaker | — | reasoningEffort: "medium" |
| Oracle | 32k budget tokens | reasoningEffort: "medium" |
| Seraph | 32k budget tokens | — |
| Smith | 32k budget tokens | reasoningEffort: "medium" |
| Sentinel | 32k budget tokens | reasoningEffort: "medium" |
| Mouse | 32k budget tokens | reasoningEffort: "medium" |

## HOW TO ADD

1. Create `src/agents/my-agent.ts` exporting factory + metadata
2. Add to `agentSources` in `src/agents/builtin-agents/`
3. Update `AgentNameSchema` in `src/config/schema/agent-names.ts`
4. Register in `src/plugin-handlers/agent-config-handler.ts`

## KEY PATTERNS

- **Factory**: `createXXXAgent(model): AgentConfig`
- **Metadata**: `XXX_PROMPT_METADATA` with category, cost, triggers
- **Model-specific prompts**: Architect, Mouse have GPT vs Claude variants
- **Dynamic prompts**: Morpheus, Keymaker use `dynamic-agent-prompt-builder.ts` to inject available tools/skills/categories

## ANTI-PATTERNS

- **Trust agent self-reports**: NEVER — always verify outputs
- **High temperature**: Don't use >0.3 for code agents
- **Sequential calls**: Use `task` with `run_in_background` for exploration
- **Oracle writing code**: Planner only — never implements
