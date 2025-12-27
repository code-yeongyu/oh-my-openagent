# Self-Improving Session Learning & Meta-Learning System - Implementation Plan

**Linear Issue**: [LIF-73](https://linear.app/lifelogger/issue/LIF-73/self-improving-chat-review-system-chat-auditor-agent-context-threshold)
**Created**: 2025-12-23
**Updated**: 2025-12-23 (REVISED: Part A Memory Tools + Part B Meta-Learning)
**Author**: Strategic Planner (OmO)
**Total Estimate**: ~12h

## Summary

Two-part system for memory management and meta-learning extraction:

### Part A: Memory Tools (~4h)
Serena-compatible memory tools for persistent storage. 5 tools: `memory_write`, `memory_read`, `memory_list`, `memory_edit`, `memory_delete`. Configurable storage path (default: `context/memory/`), subdirectory support, works without Serena MCP installed.

### Part B: Meta-Learning Extraction (~8h)
Extracts insights to improve OmO orchestration, delegation, commands, and agent instructions. NOT general chat quality scoring - specifically meta-level agentic workflow improvements. Uses `experimental.session.compacting` hook (fires BEFORE compaction) as PRIMARY trigger. Outputs to `context/learnings/{session_id}.md` for human review before promotion via `/specify`.

## Key Technical Discovery

OpenCode provides `experimental.session.compacting` hook that fires **BEFORE** compaction:
```typescript
"experimental.session.compacting"?: (
  input: { sessionID: string }, 
  output: { context: string[] }
) => Promise<void>
```

This is the PRIMARY trigger - allows extraction before context is lost.

## Technical Context

| Aspect | Details |
|--------|---------|
| **Language** | TypeScript 5.7+ |
| **Runtime** | Bun |
| **Framework** | @opencode-ai/plugin SDK |
| **Target Files** | `src/tools/memory/`, `src/features/context-learning/`, `src/hooks/`, `src/config/` |
| **Primary Trigger** | `experimental.session.compacting` (fires BEFORE compaction) |
| **Secondary Triggers** | Context 60% threshold, `session.idle` (debounced), manual `/extract-learnings` |
| **Storage Paths** | `context/memory/` (memory tools), `context/learnings/` (meta-learnings) |

## Constitution Check

| Principle | Compliance |
|-----------|------------|
| **Plugin-First Architecture** | ✅ All features via @opencode-ai/plugin SDK |
| **Multi-Model Excellence** | ✅ Gemini 2.5 Flash for cost-efficient analysis |
| **Multi-Layered Orchestration** | ✅ context-learner as Specialist |
| **Bun-Native Development** | ✅ Bun exclusively |
| **Hook-Driven Enhancement** | ✅ pre-compaction hook for auto-trigger |
| **Dogfooding** | ✅ Uses context/ directories for storage |

## Architecture

### Component Diagram
```
┌─────────────────────────────────────────────────────────────────┐
│                    PART A: MEMORY TOOLS                          │
└─────────────────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────────┐
  │                      Memory Tools                             │
  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────┐ │
  │  │ memory_  │ │ memory_  │ │ memory_  │ │ memory_  │ │mem_ │ │
  │  │  write   │ │  read    │ │  list    │ │  edit    │ │del  │ │
  │  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └──┬──┘ │
  └───────┼────────────┼────────────┼────────────┼──────────┼────┘
          │            │            │            │          │
          └────────────┴────────────┴────────────┴──────────┘
                                    │
                       ┌────────────▼────────────┐
                       │    context/memory/      │
                       │  ├── constitution.md    │
                       │  ├── architecture.md    │
                       │  ├── tech-stack.md      │
                       │  ├── glossary.md        │
                       │  └── decisions/         │
                       │      └── ADR-*.md       │
                       └─────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                 PART B: META-LEARNING EXTRACTION                 │
└─────────────────────────────────────────────────────────────────┘

                         TRIGGER PRIORITY
  ┌──────────────────────────────────────────────────────────────┐
  │ 1. PRIMARY: experimental.session.compacting (before loss)    │
  │ 2. PROACTIVE: Context 60% threshold                          │
  │ 3. PERIODIC: session.idle (debounced)                        │
  │ 4. ON-DEMAND: /extract-learnings                             │
  └──────────────────────────────────────────────────────────────┘
                                │
                    ┌───────────▼───────────┐
                    │ Multi-Signal Scorer   │
                    │ (10-50ms overhead)    │
                    └───────────┬───────────┘
                                │
                          Score ≥ 3?
                    ┌───────────┴───────────┐
                    │                       │
              YES   │                  NO   │
         ┌──────────▼──────────┐            │
         │ Background Spawner  │        (block)
         │ (context-learner)   │
         └──────────┬──────────┘
                    │
         ┌──────────▼──────────┐
         │  context-learner    │
         │  (Gemini 2.5 Flash) │
         │  Meta-Learning Focus│
         └──────────┬──────────┘
                    │
         ┌──────────▼──────────┐
         │ context/learnings/  │
         │ {session_id}.md     │
         └──────────┬──────────┘
                    │
            (human review)
                    │
         ┌──────────▼──────────┐
         │ /review-learnings   │
         │ approve/reject      │
         └──────────┬──────────┘
                    │
              Approved?
         ┌──────────┴──────────┐
         │                     │
    YES  │                NO   │
         │                     │
  ┌──────▼──────┐       (discard)
  │   /specify   │
  │ (new feature)│
  └──────────────┘
```

### Data Flow

**Memory Tools Flow (Part A)**:
1. Agent calls `memory_write(file, content)` → writes to `context/memory/{file}.md`
2. Agent calls `memory_read(file)` → reads from configured memory path
3. Agent calls `memory_list()` → lists all memory files including subdirectories
4. Agent calls `memory_edit(file, needle, replacement)` → edits via regex/literal
5. Agent calls `memory_delete(file)` → removes memory file

**Meta-Learning Extraction Flow (Part B)**:
1. **PRIMARY TRIGGER**: `experimental.session.compacting` fires (BEFORE compaction)
   - Alternative triggers: context 60%, session.idle, manual `/extract-learnings`
2. Hook computes signal score (strong/medium/weak + vetoes)
3. If score ≥ 3 AND not in cooldown → spawn background `context-learner` agent
4. Agent analyzes conversation for meta-learning opportunities:
   - Agent Instructions improvements
   - Command workflow improvements
   - Orchestration/delegation pattern improvements
   - Context handling improvements
   - Tool usage efficiency improvements
5. Candidates written to `context/learnings/{session_id}.md`
6. Human reviews candidates → decides if actionable
7. If actionable → uses `/specify` to create feature spec for improvement

## Data Models

### Meta-Learning Candidate Format
```typescript
interface MetaLearningCandidate {
  title: string                    // Short description
  claim: string                    // What should change in OmO
  category: "agent_instructions" | "commands" | "orchestration" | "context_handling" | "tool_usage"
  scope: string                    // When this applies
  confidence: number               // 0-1 score
  status: "pending" | "approved" | "rejected"
  evidence: Array<{
    type: "file" | "tool_output" | "conversation" | "pattern"
    source: string                 // File path or tool name
    context?: string               // Brief context
    excerpt: string                // Max 200 chars
  }>
  suggestedImprovement: string     // Actionable improvement
  affectedFiles?: string[]         // Files that would change
}

interface MetaLearningFile {
  metadata: {
    sessionId: string
    timestamp: string              // ISO 8601
    signalScore: number            // 0-10
    trigger: "pre_compaction" | "context_threshold" | "idle" | "manual"
    filesModified: string[]
    toolsUsed: string[]
  }
  candidates: MetaLearningCandidate[]
  extractionNotes: {
    totalCandidates: number
    highConfidence: number         // >0.8
    mediumConfidence: number       // 0.5-0.8
    lowConfidence: number          // <0.5
    cost: {
      inputTokens: number
      outputTokens: number
      estimatedUsd: number
    }
  }
}
```

### Meta-Learning Categories
```typescript
type MetaLearningCategory = 
  | "agent_instructions"   // Improve agent prompts, roles, capabilities
  | "commands"             // Improve slash command behavior, workflows
  | "orchestration"        // Improve delegation patterns, agent selection
  | "context_handling"     // Improve memory management, compaction
  | "tool_usage"           // Improve tool selection, efficiency
```

### Multi-Signal Scoring
```typescript
interface SignalScoring {
  strongSignals: Array<{           // 3 points each
    name: "edited_memory_files" | "created_shared_utilities" | "architectural_decisions" | "cross_file_refactoring"
    detected: boolean
    evidence?: string[]
  }>
  mediumSignals: Array<{           // 2 points each
    name: "decision_language" | "pattern_identification" | "cross_file_impact"
    detected: boolean
    evidence?: string[]
  }>
  weakSignals: Array<{             // 1 point each
    name: "new_file_types" | "config_changes" | "dependency_changes"
    detected: boolean
    evidence?: string[]
  }>
  vetoConditions: Array<{          // Blocks trigger
    name: "single_file_change" | "environment_specific" | "speculation"
    triggered: boolean
    reason?: string
  }>
  totalScore: number               // 0-10
  threshold: number                // From config (default: 3)
  shouldTrigger: boolean           // totalScore >= threshold AND no vetoes
}
```

## API Contracts

### Hook Events

**meta-learning-extractor-hook**:
```typescript
// PRIMARY TRIGGER: experimental.session.compacting (BEFORE compaction)
// Listens to: event({ event: { type: "experimental.session.compacting" | "session.idle" } })
// Also monitors: context usage threshold (60%)
//
// Trigger Priority:
// 1. experimental.session.compacting → PRIMARY (last chance before context loss)
// 2. Context threshold 60% → PROACTIVE (early extraction)
// 3. session.idle (debounced) → PERIODIC (after work pauses)
//
// Behavior:
// 1. Compute signal score from session.messages()
// 2. If score >= threshold AND not in cooldown:
//    - Spawn background context-learner agent with serialized context
//    - Mark session as inFlight
//    - Record lastExtractTime
// State: Map<sessionId, { inFlight: boolean, lastExtractedHash: string, lastExtractTime: Date }>
```

### Command Interfaces

**/extract-learnings**:
```markdown
---
description: "Manually trigger meta-learning extraction from current session"
agent: "context-learner"
subtask: true
---

Analyzes current session for OmO improvement opportunities.
Categories: agent_instructions, commands, orchestration, context_handling, tool_usage
Outputs: context/learnings/{session_id}.md
```

**/review-learnings**:
```markdown
---
description: "Review and approve/reject meta-learning candidates"
argument-hint: "[--category <type>] [--min-confidence <0-1>]"
agent: "OmO"
---

Displays pending meta-learning candidates from context/learnings/*.md
User approves/rejects each candidate
Approved candidates → user runs /specify to create feature spec for improvement
```

### Agent Prompts

**context-learner Agent** (Meta-Learning Focus):
```typescript
// Model: google/gemini-2.5-flash
// Role: specialist
// Tools: { write: true, edit: true, bash: false, background_task: true }
// Prompt structure:
// 1. Role: "Extract meta-learnings to improve OmO orchestration"
// 2. Task: "Analyze this session for opportunities to improve:
//           - Agent Instructions (prompts, roles, capabilities)
//           - Commands (slash command behavior, workflows)
//           - Orchestration (delegation patterns, agent selection)
//           - Context Handling (memory management, compaction)
//           - Tool Usage (tool selection, efficiency)"
// 3. Context: Serialized conversation history + metadata
// 4. Output Format: Structured markdown to context/learnings/{session_id}.md
// 5. Quality Guidelines: Specific improvements, evidence-based, actionable
// 6. Anti-Bloat: Max 3 candidates per session, confidence >0.5, no speculation
```

## Project Structure

### New Files to Create

```
src/
├── tools/
│   └── memory/                      [NEW] PART A: Memory Tools
│       ├── index.ts                 [NEW] Tool exports
│       ├── types.ts                 [NEW] Memory tool types
│       ├── constants.ts             [NEW] Default paths, config
│       ├── tools.ts                 [NEW] 5 memory tools implementation
│       └── utils.ts                 [NEW] File path resolution, validation
├── agents/
│   ├── context-learner.ts           [NEW] Gemini 2.5 Flash meta-learning agent
│   └── index.ts                     [MODIFY] Register new agent
├── hooks/
│   └── meta-learning-extractor/     [NEW] PART B: Auto-extraction hook
│       ├── index.ts                 [NEW] Hook implementation (pre-compaction primary)
│       ├── types.ts                 [NEW] Type definitions
│       ├── signal-scorer.ts         [NEW] Multi-signal scoring logic
│       └── README.md                [NEW] Hook documentation
├── config/
│   └── schema.ts                    [MODIFY] Add memory_tools + meta_learning config
└── features/
    └── context-learning/
        ├── index.ts                 [NEW] Shared utilities
        ├── types.ts                 [NEW] Data model types (MetaLearningCandidate)
        ├── file-writer.ts           [NEW] Atomic file write utilities
        └── secret-redactor.ts       [NEW] Secret detection/redaction

.opencode/
└── command/
    ├── extract-learnings.md         [NEW] Manual meta-learning extraction
    └── review-learnings.md          [NEW] Learning approval command

context/                             [NEW FOLDER - Add to .gitignore]
├── learnings/                       [AUTO-CREATED] Meta-learning candidates
└── memory/                          [AUTO-CREATED] Memory tool storage
```

### Files to Modify

```
src/config/schema.ts                 Add MemoryToolsConfigSchema + MetaLearningConfigSchema
src/agents/index.ts                  Register context-learner
src/tools/index.ts                   Export memory tools
src/hooks/index.ts                   Export meta-learning-extractor hook
src/hooks/governance-path-validator/ Add context/ to allowed paths
.gitignore                           Add context/ folder
```

## Implementation Phases

### Phase 1: Memory Tools Foundation (2h) — PART A

| Step | Task | Files | Estimate |
|------|------|-------|----------|
| 1.1 | Create memory tool types | `src/tools/memory/types.ts` | 20min |
| 1.2 | Create memory tool constants | `src/tools/memory/constants.ts` | 15min |
| 1.3 | Implement file path utils | `src/tools/memory/utils.ts` | 25min |
| 1.4 | Implement 5 memory tools | `src/tools/memory/tools.ts` | 45min |
| 1.5 | Export from index | `src/tools/memory/index.ts` | 15min |

**Dependencies**: None  
**Deliverables**: 5 working memory tools (write, read, list, edit, delete)  
**Verification**: Manual test of each tool, verify file operations work

---

### Phase 2: Memory Tools Integration (2h) — PART A

| Step | Task | Files | Estimate |
|------|------|-------|----------|
| 2.1 | Add MemoryToolsConfigSchema | `src/config/schema.ts` | 30min |
| 2.2 | Register tools in builtinTools | `src/tools/index.ts` | 15min |
| 2.3 | Update /update-context command | `.opencode/command/update-context.md` | 30min |
| 2.4 | Add context/ to governance paths | `src/hooks/governance-path-validator/` | 15min |
| 2.5 | Manual integration testing | Manual | 30min |

**Dependencies**: Phase 1  
**Deliverables**: Memory tools integrated with config and governance  
**Verification**: Memory tools work with custom paths, governance allows writes

---

### Phase 3: Meta-Learning Agent (2h) — PART B

| Step | Task | Files | Estimate |
|------|------|-------|----------|
| 3.1 | Create meta-learning data types | `src/features/context-learning/types.ts` | 20min |
| 3.2 | Implement file writer (atomic) | `src/features/context-learning/file-writer.ts` | 25min |
| 3.3 | Implement secret redactor | `src/features/context-learning/secret-redactor.ts` | 30min |
| 3.4 | Create context-learner agent | `src/agents/context-learner.ts` | 30min |
| 3.5 | Register agent in index | `src/agents/index.ts` | 15min |

**Dependencies**: Phase 1-2  
**Deliverables**: Functional context-learner agent for meta-learning  
**Verification**: Manual invocation produces valid meta-learning candidates

---

### Phase 4: Pre-Compaction Hook (3h) — PART B

| Step | Task | Files | Estimate |
|------|------|-------|----------|
| 4.1 | Create hook types | `src/hooks/meta-learning-extractor/types.ts` | 20min |
| 4.2 | Implement multi-signal scorer | `src/hooks/meta-learning-extractor/signal-scorer.ts` | 60min |
| 4.3 | Implement hook (pre-compaction primary) | `src/hooks/meta-learning-extractor/index.ts` | 60min |
| 4.4 | Register hook in index | `src/hooks/index.ts` | 15min |
| 4.5 | Test auto-trigger on compacting event | Manual | 25min |

**Dependencies**: Phase 3  
**Deliverables**: Auto-trigger meta-learning extraction on pre-compaction  
**Verification**: Session compaction triggers extraction BEFORE context is lost

---

### Phase 5: Commands & Review Workflow (2h) — PART B

| Step | Task | Files | Estimate |
|------|------|-------|----------|
| 5.1 | Create /extract-learnings command | `.opencode/command/extract-learnings.md` | 45min |
| 5.2 | Create /review-learnings command | `.opencode/command/review-learnings.md` | 45min |
| 5.3 | Test end-to-end workflow | Manual | 30min |

**Dependencies**: Phase 3-4  
**Deliverables**: Manual extraction and review commands  
**Verification**: End-to-end workflow (extract → review → /specify for feature)

---

### Phase 6: Polish & Documentation (1h)

| Step | Task | Files | Estimate |
|------|------|-------|----------|
| 6.1 | Write hook README | `src/hooks/meta-learning-extractor/README.md` | 20min |
| 6.2 | Update AGENTS.md | `AGENTS.md` | 15min |
| 6.3 | Update config schema docs | `oh-my-opencode.schema.json` | 10min |
| 6.4 | Update .gitignore | `.gitignore` | 5min |
| 6.5 | Final integration testing | Manual | 10min |

**Dependencies**: All phases  
**Deliverables**: Complete documentation, clean build  
**Verification**: Build passes, schema generation works

---

## Dependencies

### Internal (This Repo)

| Dependency | Status | Notes |
|------------|--------|-------|
| `src/features/background-agent/manager.ts` | Exists | Background task spawning |
| `src/hooks/governance-path-validator/` | Exists | Path validation for context/ |
| `src/config/schema.ts` | Exists | Config schema extension |
| `@opencode-ai/plugin` SDK | Exists | Hook/agent/tool APIs |
| `experimental.session.compacting` hook | Exists | OpenCode provides this event |

### External

| Dependency | Status | Notes |
|------------|--------|-------|
| Gemini 2.5 Flash API | Required | Model availability ($0.30/M input) |
| OpenCode ≥1.0.132 | Required | Config bug fixes, hook support |

## Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Pre-compaction timing** | Low | Medium | Ensure hook fires early enough to serialize context |
| **False positive triggers** | Medium | Medium | Tunable threshold (default: 3), veto conditions, human approval |
| **False negative triggers** | Medium | Medium | Dual trigger (pre-compaction + idle), manual extraction option |
| **Candidate bloat** | Medium | Medium | Max 3 candidates/session, confidence scoring |
| **Governance blocks** | Low | High | Add context/ to default allowed paths in Phase 2 |
| **Secret leakage** | Medium | Critical | Redaction patterns, excerpt limits |
| **Cost runaway** | Low | Medium | Daily budget cap, cooldown, pre-filtering (blocks 90-97%) |

## Testing Strategy

### Unit Tests (Phase 1-2)
- Memory tool file operations (write, read, list, edit, delete)
- Path resolution with subdirectory support
- File writer atomic operations
- Secret redaction patterns (API keys, tokens, private keys)

### Integration Tests (Phase 4-5)
- Pre-compaction hook → Background agent spawning
- Agent → File write to context/learnings/
- Command → Agent delegation
- End-to-end: compacting event → extraction → review

### Manual Verification (All Phases)
- Memory tools: write/read/list/edit/delete work correctly
- Trigger pre-compaction with architectural changes → verify extraction
- Low signal session → verify NO extraction
- Manual `/extract-learnings` → verify learnings file created
- `/review-learnings` → approve candidate → verify actionable

### Performance Tests (Phase 4)
- Signal scoring overhead: <100ms on compacting event
- Background spawn: <500ms to launch agent
- File write: <50ms for atomic write

## Success Metrics

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| **Memory Tools Reliability** | 100% file operations succeed | Manual testing |
| **Pre-Compaction Capture** | 95% of compactions trigger extraction | Event logging |
| **Meta-Learning Accuracy** | 80% valuable learnings | Manual review sampling |
| **False Trigger Rate** | <20% zero-value sessions | Count sessions with no candidates |
| **Non-Blocking Performance** | <100ms compacting event impact | Performance profiling |
| **Cost Efficiency** | <$0.01/analysis average | Cost tracking |

## Time Summary

| Phase | Part | Estimate |
|-------|------|----------|
| Phase 1: Memory Tools Foundation | A | 2h |
| Phase 2: Memory Tools Integration | A | 2h |
| Phase 3: Meta-Learning Agent | B | 2h |
| Phase 4: Pre-Compaction Hook | B | 3h |
| Phase 5: Commands & Review Workflow | B | 2h |
| Phase 6: Polish & Documentation | - | 1h |
| **Total** | | **~12h** |

## Next Steps

After plan approval:
1. Run `/tasks` to create task breakdown from this plan
2. Run `/implement` to start Phase 1 (Memory Tools Foundation)
3. Incremental delivery: Each phase independently testable
4. Update workflow state after each phase completion
