# AGENTS KNOWLEDGE BASE

## OVERVIEW
AI agent definitions for multi-model orchestration, delegating tasks to specialized experts.

## STRUCTURE
```
agents/
├── orchestrator-sisyphus.ts # Orchestrator agent (1531 lines) - 7-section delegation, wisdom
├── sisyphus.ts              # Main Sisyphus prompt (640 lines)
├── sisyphus-junior.ts       # Junior variant for delegated tasks
├── oracle.ts                # Strategic advisor (GPT-5.2)
├── librarian.ts             # Multi-repo research (GLM-4.7-free)
├── explore.ts               # Fast codebase grep (Grok Code)
├── frontend-ui-ux-engineer.ts  # UI generation (Gemini 3 Pro Preview)
├── document-writer.ts       # Technical docs (Gemini 3 Pro Preview)
├── multimodal-looker.ts     # PDF/image analysis (Gemini 3 Flash)
├── prometheus-prompt.ts     # Planning agent prompt (1196 lines) - interview mode
├── metis.ts                 # Plan Consultant agent - pre-planning analysis
├── momus.ts                 # Plan Reviewer agent - plan validation
├── build-prompt.ts          # Shared build agent prompt
├── plan-prompt.ts           # Shared plan agent prompt
├── sisyphus-prompt-builder.ts # Factory for orchestrator prompts
├── types.ts                 # AgentModelConfig interface
├── utils.ts                 # createBuiltinAgents(), getAgentName()
└── index.ts                 # builtinAgents export
```

## HOW TO ADD AN AGENT
1. Create `src/agents/my-agent.ts` exporting `AgentConfig`.
2. Add to `builtinAgents` in `src/agents/index.ts`.
3. Update `types.ts` if adding new config interfaces.

## MODEL FALLBACK LOGIC
`createBuiltinAgents()` handles resolution:
1. User config override (`agents.{name}.model`).
2. Environment-specific settings (max20, antigravity).
3. Hardcoded defaults in `index.ts`.

## SHARED PROMPTS
- **7-Section Delegation**: `orchestrator-sisyphus.ts` uses strict phases (0-6) for classification, research, planning, validation.
- **Wisdom Notepad**: Persistent scratchpad preserving project-specific learnings across turns.
- **Interview Mode**: `Prometheus` defaults to conversational consultant mode for requirement extraction.
- **build-prompt.ts**: Unified base for Sisyphus and Builder variants.
- **plan-prompt.ts**: Core planning logic shared across planning agents.

## ANTI-PATTERNS
- **Trusting reports**: NEVER trust subagent self-reports; always verify outputs.
- **High temp**: Don't use >0.3 for code agents (Sisyphus/Prometheus use 0.1).
- **Sequential calls**: Prefer `delegate_task` with `run_in_background` for parallelism.
