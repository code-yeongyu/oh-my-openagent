# AGENTS KNOWLEDGE BASE

## OVERVIEW

10 AI agents for multi-model orchestration. Sisyphus (primary), oracle, librarian, explore, frontend, document-writer, multimodal-looker, Prometheus, Metis, Momus.

## STRUCTURE

```
agents/
├── orchestrator-sisyphus.ts    # Orchestrator (1531 lines) - 7-phase delegation
├── sisyphus.ts                 # Main prompt (640 lines)
├── sisyphus-junior.ts          # Delegated task executor
├── sisyphus-prompt-builder.ts  # Dynamic prompt generation
├── oracle.ts                   # Strategic advisor
├── librarian.ts                # Multi-repo research
├── explore.ts                  # Fast contextual grep
├── frontend-ui-ux-engineer.ts  # UI specialist
├── document-writer.ts          # Technical writer
├── multimodal-looker.ts        # Media analyzer
├── prometheus-prompt.ts        # Planning (1196 lines) - interview mode
├── metis.ts                    # Plan consultant - pre-planning analysis
├── momus.ts                    # Plan reviewer - validation
├── types.ts                    # AgentModelConfig interface
├── utils.ts                    # createBuiltinAgents(), getAgentName()
└── index.ts                    # builtinAgents export
```

## AGENT MODELS

Models are inherited from system default (OpenCode config) unless overridden via user config.

| Agent | Model | Temperature | Purpose |
|-------|-------|-------------|---------|
| Sisyphus | *(inherited)* | 0.1 | Primary orchestrator, todo-driven |
| oracle | *(inherited)* | 0.1 | Read-only consultation, debugging |
| librarian | *(inherited)* | 0.1 | Docs, GitHub search, OSS examples |
| explore | *(inherited)* | 0.1 | Fast contextual grep |
| frontend-ui-ux-engineer | *(inherited)* | 0.7 | UI generation, visual design |
| document-writer | *(inherited)* | 0.3 | Technical documentation |
| multimodal-looker | *(inherited)* | 0.1 | PDF/image analysis |
| Prometheus | *(inherited)* | 0.1 | Strategic planning, interview mode |
| Metis | *(inherited)* | 0.1 | Pre-planning gap analysis |
| Momus | *(inherited)* | 0.1 | Plan validation |

**Model Resolution**: User config (`agents.{name}.model`) → Parent model → System default model

## HOW TO ADD

1. Create `src/agents/my-agent.ts` exporting `AgentConfig`
2. Add to `builtinAgents` in `src/agents/index.ts`
3. Update `AgentNameSchema` in `src/config/schema.ts`
4. Register in `src/index.ts` initialization

## TOOL RESTRICTIONS

| Agent | Denied Tools |
|-------|-------------|
| oracle | write, edit, task, delegate_task |
| librarian | write, edit, task, delegate_task, call_omo_agent |
| explore | write, edit, task, delegate_task, call_omo_agent |
| multimodal-looker | Allowlist: read, glob, grep |

## KEY PATTERNS

- **Factory**: `createXXXAgent(model?: string): AgentConfig`
- **Metadata**: `XXX_PROMPT_METADATA: AgentPromptMetadata`
- **Tool restrictions**: `permission: { edit: "deny", bash: "ask" }`
- **Thinking**: 32k budget tokens for Sisyphus, Oracle, Prometheus

## ANTI-PATTERNS

- **Trust reports**: NEVER trust subagent "I'm done" - verify outputs
- **High temp**: Don't use >0.3 for code agents
- **Sequential calls**: Use `delegate_task` with `run_in_background`
