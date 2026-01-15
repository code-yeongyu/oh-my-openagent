# AGENTS KNOWLEDGE BASE

## OVERVIEW
AI agent definitions for multi-model orchestration, delegating tasks to specialized experts.

## STRUCTURE
```
agents/
├── orchestrator-sisyphus.ts # Orchestrator agent (1485 lines) - 7-section delegation, wisdom
├── sisyphus.ts              # Main Sisyphus prompt (643 lines)
├── sisyphus-junior.ts       # Junior variant for delegated tasks
├── oracle.ts                # Strategic advisor (GPT-5.2)
├── librarian.ts             # Multi-repo research (GLM-4.7-free)
├── explore.ts               # Fast codebase grep (Grok Code)
├── frontend-ui-ux-engineer.ts  # UI generation (Gemini 3 Pro Preview)
├── document-writer.ts       # Technical docs (Gemini 3 Pro Preview)
├── multimodal-looker.ts     # PDF/image analysis (Gemini 3 Flash)
├── prometheus-prompt.ts     # Planning agent prompt (991 lines) - interview mode
├── metis.ts                 # Plan Consultant agent - pre-planning analysis
├── momus.ts                 # Plan Reviewer agent - plan validation
├── build-prompt.ts          # Shared build agent prompt
├── plan-prompt.ts           # Shared plan agent prompt
├── sisyphus-prompt-builder.ts # Factory for orchestrator prompts
├── types.ts                 # AgentModelConfig interface
├── utils.ts                 # createBuiltinAgents(), getAgentName()
└── index.ts                 # builtinAgents export
```

## AGENT MODELS
| Agent | Default Model | Purpose |
|-------|---------------|---------|
| Sisyphus | anthropic/claude-opus-4-5 | Primary orchestrator. 32k extended thinking budget. |
| oracle | openai/gpt-5.2 | High-IQ debugging, architecture, strategic consultation. |
| librarian | opencode/glm-4.7-free | Multi-repo analysis, docs research, GitHub examples. |
| explore | opencode/grok-code | Fast contextual grep. Fallbacks: Gemini-3-Flash, Haiku-4-5. |
| frontend-ui-ux | google/gemini-3-pro-preview | Production-grade UI/UX generation and styling. |
| document-writer | google/gemini-3-pro-preview | Technical writing, guides, API documentation. |
| Prometheus | anthropic/claude-opus-4-5 | Strategic planner. Interview mode, orchestrates Metis/Momus. |
| Metis | anthropic/claude-sonnet-4-5 | Plan Consultant. Pre-planning risk/requirement analysis. |
| Momus | anthropic/claude-sonnet-4-5 | Plan Reviewer. Validation and quality enforcement. |

## HOW TO ADD AN AGENT
1. Create `src/agents/my-agent.ts` exporting `AgentConfig`.
2. Add to `builtinAgents` in `src/agents/index.ts`.
3. Update `types.ts` if adding new config interfaces.

## MODEL FALLBACK LOGIC
`createBuiltinAgents()` handles resolution:
1. User config override (`agents.{name}.model`).
2. Environment-specific settings (max20, antigravity).
3. Hardcoded defaults in `index.ts`.

## ANTI-PATTERNS
- **Trusting reports**: NEVER trust subagent self-reports; always verify outputs.
- **High temp**: Don't use >0.3 for code agents (Sisyphus/Prometheus use 0.1).
- **Sequential calls**: Prefer `sisyphus_task` with `run_in_background` for parallelism.

## SHARED PROMPTS
- **build-prompt.ts**: Unified base for Sisyphus and Builder variants.
- **plan-prompt.ts**: Core planning logic shared across planning agents.
- **orchestrator-sisyphus.ts**: Uses a 7-section prompt structure and "wisdom notepad" to preserve learnings across turns.
