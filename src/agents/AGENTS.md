# src/agents/ — 11 Agent Definitions

**Generated:** 2026-03-02

## OVERVIEW

Agent factories following `createXXXAgent(model) → AgentConfig` pattern. Each has static `mode` property. Built via `buildAgent()` compositing factory + categories + skills.

## AGENT INVENTORY

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
| **Atlas** | kimi-k2.5 | 0.1 | primary | claude-sonnet-4-6 → gpt-5.2 | Todo-list orchestrator |
| **Prometheus** | claude-opus-4-6 | 0.1 | — | kimi-k2.5 → gpt-5.2 → gemini-3.1-pro | Strategic planner (internal) |
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

Model resolution: `AGENT_MODEL_REQUIREMENTS` in `shared/model-requirements.ts` defines fallback chains per agent.

## MODES

- **primary**: Respects UI-selected model, uses fallback chain
- **subagent**: Uses own fallback chain, ignores UI selection
- **all**: Available in both contexts (Sisyphus-Junior)
