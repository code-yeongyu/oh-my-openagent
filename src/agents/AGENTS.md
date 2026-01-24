# AGENTS KNOWLEDGE BASE

## OVERVIEW

10 AI agents for multi-model orchestration. Sisyphus (primary), Atlas (orchestrator), oracle, librarian, explore, multimodal-looker, Prometheus, Metis, Momus, Sisyphus-Junior.

## STRUCTURE

```
agents/
├── atlas.ts                    # Master Orchestrator (543 lines)
├── sisyphus.ts                 # Main prompt (615 lines)
├── sisyphus-junior.ts          # Delegated task executor
├── dynamic-agent-prompt-builder.ts  # Dynamic prompt generation
├── oracle.ts                   # Strategic advisor (GPT-5.2)
├── librarian.ts                # Multi-repo research (GLM-4.7-free)
├── explore.ts                  # Fast grep (Grok Code)
├── multimodal-looker.ts        # Media analyzer (Gemini 3 Flash)
├── prometheus-prompt.ts        # Planning (1196 lines)
├── metis.ts                    # Plan consultant
├── momus.ts                    # Plan reviewer
├── types.ts                    # AgentModelConfig, AgentPromptMetadata
├── utils.ts                    # createBuiltinAgents(), resolveModelWithFallback()
└── index.ts                    # builtinAgents export
```

## AGENT MODELS

| Agent | Model | Temp | Purpose |
|-------|-------|------|---------|
| Sisyphus | anthropic/claude-opus-4-5 | 0.1 | Primary orchestrator |
| Atlas | anthropic/claude-opus-4-5 | 0.1 | Master orchestrator |
| oracle | openai/gpt-5.2 | 0.1 | Consultation, debugging |
| librarian | opencode/big-pickle | 0.1 | Docs, GitHub search |
| explore | opencode/gpt-5-nano | 0.1 | Fast contextual grep |
| multimodal-looker | google/gemini-3-flash | 0.1 | PDF/image analysis |
| Prometheus | anthropic/claude-opus-4-5 | 0.1 | Strategic planning |
| Metis | anthropic/claude-sonnet-4-5 | 0.3 | Pre-planning analysis |
| Momus | anthropic/claude-sonnet-4-5 | 0.1 | Plan validation |
| Sisyphus-Junior | anthropic/claude-sonnet-4-5 | 0.1 | Category-spawned executor |

## HOW TO ADD

1. Create `src/agents/my-agent.ts` exporting factory + metadata
2. Add to `agentSources` in `src/agents/utils.ts`
3. Update `AgentNameSchema` in `src/config/schema.ts`
4. Register in `src/index.ts` initialization

## TOOL RESTRICTIONS

| Agent | Denied Tools |
|-------|-------------|
| oracle | write, edit, task, delegate_task |
| librarian | write, edit, task, delegate_task, call_omo_agent |
| explore | write, edit, task, delegate_task, call_omo_agent |
| multimodal-looker | Allowlist: read only |
| Sisyphus-Junior | task, delegate_task |

## PATTERNS

- **Factory**: `createXXXAgent(model?: string): AgentConfig`
- **Metadata**: `XXX_PROMPT_METADATA` with category, cost, triggers
- **Tool restrictions**: `createAgentToolRestrictions(tools)` or `createAgentToolAllowlist(tools)`
- **Thinking**: 32k budget tokens for Sisyphus, Oracle, Prometheus, Atlas

## ANTI-PATTERNS

- **Trust reports**: NEVER trust "I'm done" - verify outputs
- **High temp**: Don't use >0.3 for code agents
- **Sequential calls**: Use `delegate_task` with `run_in_background`
