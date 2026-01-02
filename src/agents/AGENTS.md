# AGENTS KNOWLEDGE BASE

## OVERVIEW

7 AI agents for multi-model orchestration. Sisyphus orchestrates, specialists handle domains.

## STRUCTURE

```
agents/
├── sisyphus.ts              # Primary orchestrator (504 lines)
├── oracle.ts                # Strategic advisor
├── librarian.ts             # Multi-repo research
├── explore.ts               # Fast codebase grep
├── frontend-ui-ux-engineer.ts  # UI generation
├── document-writer.ts       # Technical docs
├── multimodal-looker.ts     # PDF/image analysis
├── sisyphus-prompt-builder.ts  # Sisyphus prompt construction
├── build-prompt.ts          # Shared build agent prompt
├── plan-prompt.ts           # Shared plan agent prompt
├── types.ts                 # AgentModelConfig interface
├── utils.ts                 # createBuiltinAgents(), getAgentName()
└── index.ts                 # builtinAgents export
```

## AGENT MODELS

| Agent | Model | Fallback | Purpose |
|-------|-------|----------|---------|
| Sisyphus | anthropic/claude-opus-4-5 | - | Orchestrator with extended thinking |
| oracle | openai/gpt-5.2 | - | Architecture, debugging, review |
| librarian | anthropic/claude-sonnet-4-5 | google/gemini-3-flash | Docs, GitHub research |
| explore | opencode/grok-code | gemini-3-flash, haiku-4-5 | Contextual grep |
| frontend-ui-ux-engineer | google/gemini-3-pro-preview | - | Beautiful UI code |
| document-writer | google/gemini-3-pro-preview | - | Technical writing |
| multimodal-looker | google/gemini-3-flash | - | Visual analysis |

## HOW TO ADD

1. Create `src/agents/my-agent.ts`:
   ```typescript
   export const myAgent: AgentConfig = {
     model: "provider/model-name",
     temperature: 0.1,
     system: "...",
     tools: { include: ["tool1"] },
   }
   ```
2. Add to `builtinAgents` in index.ts
3. Update types.ts if new config options

## MODEL FALLBACK

`createBuiltinAgents()` handles fallback:
1. User config override
2. Installer settings (claude max20, gemini antigravity)
3. Default model

## ANTI-PATTERNS

- High temperature (>0.3) for code agents
- Broad tool access (prefer explicit `include`)
- Monolithic prompts (delegate to specialists)
- Missing fallbacks for rate-limited models
