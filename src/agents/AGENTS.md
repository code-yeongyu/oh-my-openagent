# AGENTS KNOWLEDGE BASE

## OVERVIEW

8 AI agents for multi-model orchestration. Sisyphus (primary), oracle, librarian, explore, multimodal-looker, Prometheus, Metis, Momus.

## STRUCTURE

```
agents/
├── orchestrator-sisyphus.ts # Orchestrator agent (1486 lines) - 7-section delegation, wisdom
├── sisyphus.ts              # Main Sisyphus prompt (643 lines)
├── sisyphus-junior.ts       # Junior variant for delegated tasks
├── oracle.ts                # Strategic advisor (GPT-5.2)
├── librarian.ts             # Multi-repo research (GLM-4.7-free)
├── explore.ts               # Fast codebase grep (Grok Code)
├── frontend-ui-ux-engineer.ts  # UI generation (Gemini 3 Pro)
├── document-writer.ts       # Technical docs (Gemini 3 Pro)
├── multimodal-looker.ts     # PDF/image analysis (Gemini 3 Flash)
├── prometheus-prompt.ts     # Planning agent prompt (988 lines) - interview mode
├── metis.ts                 # Plan Consultant agent - pre-planning analysis
├── momus.ts                 # Plan Reviewer agent - plan validation
├── sherlock.ts              # Hypothesis-driven debugger (GPT-5.2)
├── build-prompt.ts          # Shared build agent prompt
├── plan-prompt.ts           # Shared plan agent prompt
├── types.ts                 # AgentModelConfig interface
├── utils.ts                 # createBuiltinAgents(), getAgentName()
└── index.ts                 # builtinAgents export
```

## AGENT MODELS
| Agent | Default Model | Purpose |
|-------|---------------|---------|
| Sisyphus | claude-opus-4-5 | Primary orchestrator. 32k extended thinking budget. |
| oracle | openai/gpt-5.2 | High-IQ debugging, architecture, strategic consultation. |
| librarian | glm-4.7-free | Multi-repo analysis, docs research, GitHub examples. |
| explore | grok-code | Fast contextual grep. Fallbacks: Gemini-3-Flash, Haiku-4-5. |
| frontend-ui-ux | gemini-3-pro | Production-grade UI/UX generation and styling. |
| document-writer | gemini-3-pro | Technical writing, guides, API documentation. |
| Prometheus | claude-opus-4-5 | Strategic planner. Interview mode, orchestrates Metis/Momus. |
| Metis | claude-sonnet-4-5 | Plan Consultant. Pre-planning risk/requirement analysis. |
| Momus | claude-sonnet-4-5 | Plan Reviewer. Validation and quality enforcement. |
| sherlock | openai/gpt-5.2 | Hypothesis-driven debugger. Runtime evidence-based bug diagnosis. |
├── atlas.ts    # Orchestrator (1531 lines) - 7-phase delegation
├── sisyphus.ts                 # Main prompt (640 lines)
├── sisyphus-junior.ts          # Delegated task executor
├── dynamic-agent-prompt-builder.ts  # Dynamic prompt generation
├── oracle.ts                   # Strategic advisor (GPT-5.2)
├── librarian.ts                # Multi-repo research (GLM-4.7-free)
├── explore.ts                  # Fast grep (Grok Code)
├── multimodal-looker.ts        # Media analyzer (Gemini 3 Flash)
├── prometheus-prompt.ts        # Planning (1196 lines) - interview mode
├── metis.ts                    # Plan consultant - pre-planning analysis
├── momus.ts                    # Plan reviewer - validation
├── types.ts                    # AgentModelConfig interface
├── utils.ts                    # createBuiltinAgents(), getAgentName()
└── index.ts                    # builtinAgents export
```

## AGENT MODELS

| Agent | Model | Temperature | Purpose |
|-------|-------|-------------|---------|
| Sisyphus | anthropic/claude-opus-4-5 | 0.1 | Primary orchestrator, todo-driven |
| oracle | openai/gpt-5.2 | 0.1 | Read-only consultation, debugging |
| librarian | opencode/glm-4.7-free | 0.1 | Docs, GitHub search, OSS examples |
| explore | opencode/grok-code | 0.1 | Fast contextual grep |
| multimodal-looker | google/gemini-3-flash | 0.1 | PDF/image analysis |
| Prometheus | anthropic/claude-opus-4-5 | 0.1 | Strategic planning, interview mode |
| Metis | anthropic/claude-sonnet-4-5 | 0.1 | Pre-planning gap analysis |
| Momus | anthropic/claude-sonnet-4-5 | 0.1 | Plan validation |

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
