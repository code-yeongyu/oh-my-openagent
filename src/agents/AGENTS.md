# src/agents/ — 11 Agent Definitions

**Generated:** 2026-03-06

## OVERVIEW

Agent factories following `createXXXAgent(model) → AgentConfig` pattern. Each has static `mode` property. Built via `buildAgent()` compositing factory + categories + skills.

## AGENT INVENTORY

| Agent | Model | Temp | Mode | Fallback Chain | Purpose |
|-------|-------|------|------|----------------|---------|
| **Sisyphus** | claude-opus-4-6 max | 0.1 | all | k2p5 → kimi-k2.5 → gpt-5.4 medium → glm-5 → big-pickle | Main orchestrator, plans + delegates |
| **Hephaestus** | gpt-5.3-codex medium | 0.1 | all | gpt-5.4 medium (copilot) | Autonomous deep worker |
| **Oracle** | gpt-5.4 high | 0.1 | subagent | gemini-3.1-pro high → claude-opus-4-6 max | Read-only consultation |
| **Librarian** | gemini-3-flash | 0.1 | subagent | minimax-m2.5-free → big-pickle | External docs/code search |
| **Explore** | grok-code-fast-1 | 0.1 | subagent | minimax-m2.5-free → claude-haiku-4-5 → gpt-5-nano | Contextual grep |
| **Multimodal-Looker** | gpt-5.3-codex medium | 0.1 | subagent | k2p5 → gemini-3-flash → glm-4.6v → gpt-5-nano | PDF/image analysis |
| **Metis** | claude-opus-4-6 max | **0.3** | subagent | gpt-5.4 high → gemini-3.1-pro high | Pre-planning consultant |
| **Momus** | gpt-5.4 xhigh | 0.1 | subagent | claude-opus-4-6 max → gemini-3.1-pro high | Plan reviewer |
| **Atlas** | claude-sonnet-4-6 | 0.1 | primary | gpt-5.4 medium | Todo-list orchestrator |
| **Prometheus** | claude-opus-4-6 max | 0.1 | — | gpt-5.4 high → gemini-3.1-pro | Strategic planner (internal) |
| **Sisyphus-Junior** | claude-sonnet-4-6 | 0.1 | all | user-configurable | Category-spawned executor |

## TOOL RESTRICTIONS

| Agent | Denied Tools |
|-------|-------------|
| Oracle | write, edit, task, call_omo_agent |
| Librarian | write, edit, task, call_omo_agent |
| Explore | write, edit, task, call_omo_agent |
| Multimodal-Looker | ALL except read |
| Atlas | task, call_omo_agent |
| Momus | write, edit, task |

## STRUCTURE

```
agents/
├── sisyphus.ts            # 559 LOC, main orchestrator
├── hephaestus.ts          # 507 LOC, autonomous worker
├── oracle.ts              # Read-only consultant
├── librarian.ts           # External search
├── explore.ts             # Codebase grep
├── multimodal-looker.ts   # Vision/PDF
├── metis.ts               # Pre-planning
├── momus.ts               # Plan review
├── atlas/agent.ts         # Todo orchestrator
├── types.ts               # AgentFactory, AgentMode
├── agent-builder.ts       # buildAgent() composition
├── utils.ts               # Agent utilities
├── builtin-agents.ts      # createBuiltinAgents() registry
└── builtin-agents/        # maybeCreateXXXConfig conditional factories
    ├── sisyphus-agent.ts
    ├── hephaestus-agent.ts
    ├── atlas-agent.ts
    ├── general-agents.ts  # collectPendingBuiltinAgents
    └── available-skills.ts
```

## FACTORY PATTERN

```typescript
const createXXXAgent: AgentFactory = (model: string) => ({
  instructions: "...",
  model,
  temperature: 0.1,
  // ...config
})
createXXXAgent.mode = "subagent" // or "primary" or "all"
```

Model resolution: 4-step: override → category-default → provider-fallback → system-default. Defined in `shared/model-requirements.ts`.

## MODES

- **primary**: Respects UI-selected model, uses fallback chain
- **subagent**: Uses own fallback chain, ignores UI selection
- **all**: Available in both contexts (Sisyphus-Junior)
