# Tasks: Docs Publisher Agent

**Input**: Design documents from `.cursor/specs/004-feat-documentation-master-agent/`
**Prerequisites**: plan.md ✅, spec.md ✅
**Renamed**: documentation-master → docs-publisher

## Agent Routing Summary

| Task Type | Agent | Examples |
|-----------|-------|----------|
| Content creation | document-writer | README, API docs, prose |
| Site operations | docs-publisher | Navigation, validation, publish |

---

## Phase 1: Agent File Creation

**Goal**: Create docs-publisher agent TypeScript definition

| ID | Status | Task | File |
|----|--------|------|------|
| T001 | Done | Create docs-publisher.ts with AgentConfig | `src/agents/docs-publisher.ts` |

**Details for T001**:
- Export `docsPublisherAgent: AgentConfig`
- Model: `google/gemini-3-pro-preview`
- Mode: `subagent`
- Tools: `{ background_task: false }`
- Prompt sections: role, scope, workflow, integrations, platforms, guardrails
- Focus: site operations (NOT content creation)
- ~150 lines

**Checkpoint**: Agent file compiles

---

## Phase 2: Type System Integration

**Goal**: Add docs-publisher to type system

| ID | Status | Task | File |
|----|--------|------|------|
| T002 | Done | [P] Add to BuiltinAgentName union | `src/agents/types.ts` |
| T003 | Done | [P] Add to DELEGATABLE_AGENTS array | `src/agents/types.ts` |

**Details**:
- T002: Add `| "docs-publisher"` to BuiltinAgentName
- T003: Add `"docs-publisher",` to DELEGATABLE_AGENTS

**Checkpoint**: Types compile

---

## Phase 3: Agent Registration

**Goal**: Register agent in plugin registry

| ID | Status | Task | File |
|----|--------|------|------|
| T004 | Done | Import docsPublisherAgent | `src/agents/index.ts` |
| T005 | Done | Add to builtinAgents record | `src/agents/index.ts` |
| T006 | Done | Add to AGENT_ROLE_REGISTRY as specialist | `src/agents/index.ts` |

**Details**:
- T004: `import { docsPublisherAgent } from "./docs-publisher"`
- T005: `"docs-publisher": docsPublisherAgent,`
- T006: `"docs-publisher": "specialist",`

**Checkpoint**: All imports resolve

---

## Phase 4: Verification

**Goal**: Verify complete integration

| ID | Status | Task | Command |
|----|--------|------|---------|
| T007 | Done | Run typecheck | `bun run typecheck` |
| T008 | Done | Run build | `bun run build` |

**Acceptance**:
- T007: Exit 0, no type errors
- T008: Exit 0, build succeeds

**Checkpoint**: Feature complete

---

## Dependencies

```
T001 (agent file)
    ↓
T002, T003 [parallel]
    ↓
T004 → T005 → T006 [sequential]
    ↓
T007 → T008 [sequential]
```

**Total**: 8 tasks | **Estimated**: ~30 min

---

## Notes

- Agent name: `docs-publisher` (not documentation-master)
- Role: specialist (parallel to document-writer)
- Cannot delegate: `background_task: false`
- Focus: site operations, NOT content writing
