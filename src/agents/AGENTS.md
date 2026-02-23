# src/agents/ — 13 Agent Definitions

**Generated:** 2026-02-21

## OVERVIEW

Agent factories following `createXXXAgent(model) → AgentConfig` pattern. Each has static `mode` property. Built via `buildAgent()` compositing factory + categories + skills.

## AGENT INVENTORY

| Agent | Model | Temp | Mode | Fallback Chain | Purpose |
|-------|-------|------|------|----------------|---------|
| **Sisyphus** | claude-opus-4-6 | 0.1 | primary | kimi-k2.5 → glm-4.7 → gemini-3-pro | Main orchestrator, plans + delegates |
| **Hephaestus** | gpt-5.3-codex | 0.1 | primary | NONE (required) | Autonomous deep worker |
| **Oracle** | gpt-5.2 | 0.1 | subagent | claude-opus-4-6 → gemini-3-pro | Read-only consultation |
| **Librarian** | glm-4.7 | 0.1 | subagent | big-pickle → claude-sonnet-4-6 | External docs/code search |
| **Explore** | grok-code-fast-1 | 0.1 | subagent | claude-haiku-4-5 → gpt-5-nano | Contextual grep |
| **Multimodal-Looker** | gemini-3-flash | 0.1 | subagent | gpt-5.2 → glm-4.6v → ... (6 deep) | PDF/image analysis |
| **Metis** | claude-opus-4-6 | **0.3** | subagent | kimi-k2.5 → gpt-5.2 → gemini-3-pro | Pre-planning consultant |
| **Momus** | gpt-5.2 | 0.1 | subagent | claude-opus-4-6 → gemini-3-pro | Plan reviewer |
| **Atlas** | claude-sonnet-4-6 | 0.1 | primary | kimi-k2.5 → gpt-5.2 → gemini-3-pro | Todo-list orchestrator |
| **Prometheus** | claude-opus-4-6 | 0.1 | — | kimi-k2.5 → gpt-5.2 → gemini-3-pro | Strategic planner (internal) |
| **Athena** | claude-opus-4-6 | 0.1 | primary | kimi-k2.5 → glm-4.7 → gpt-5.2 → gemini-3-pro | Multi-model council orchestrator |
| **Council-Member** | gpt-5-nano | 0.1 | subagent | NONE | Independent council analyst |
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
| Athena | write, edit, call_omo_agent |
| Council-Member | ALL except read, grep, glob, lsp_*, ast_grep_search (allow-list) |

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
├── athena/                # Multi-model council orchestrator
│   ├── agent.ts           # Athena agent factory + system prompt
│   ├── council-member-agent.ts  # Council member agent factory
│   ├── model-thinking-config.ts  # Per-provider thinking/reasoning config
│   └── model-thinking-config.test.ts  # Tests for thinking config
├── types.ts               # AgentFactory, AgentMode
├── agent-builder.ts       # buildAgent() composition
├── utils.ts               # Agent utilities
├── builtin-agents.ts      # createBuiltinAgents() registry
└── builtin-agents/        # maybeCreateXXXConfig conditional factories
    ├── sisyphus-agent.ts
    ├── hephaestus-agent.ts
    ├── atlas-agent.ts
    ├── council-member-agents.ts  # Council member registration
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
