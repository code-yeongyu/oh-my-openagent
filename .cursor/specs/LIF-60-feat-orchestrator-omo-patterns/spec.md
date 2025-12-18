# Feature Specification: Restructure Orchestrator and Agent Instructions Using OmO Patterns

**Feature ID**: `LIF-60-feat-orchestrator-omo-patterns`  
**Created**: 2025-12-18  
**Status**: Draft  
**Linear Issue**: [LIF-60](https://linear.app/lifelogger/issue/LIF-60)  
**Branch**: `hello/lif-60-restructure-orchestrator-and-agent-instructions-using-omo`

## Executive Summary

Apply lessons learned from OmO's concise, effective agent design (~778 lines for orchestration) to dramatically reduce orchestrator and agent instruction verbosity (currently 3,500+ lines for 4 agents) while improving clarity and effectiveness.

**Target**: 50%+ reduction in total instruction lines while preserving all functionality.

---

## User Scenarios & Testing

### User Story 1 - Faster Orchestrator Response (Priority: P1)

A developer invokes the orchestrator for a task. The orchestrator processes the request faster because it has less context to parse (600 lines vs 2000+ lines), resulting in quicker time-to-first-action.

**Why this priority**: Performance is the primary driver for this refactoring. Developers experience latency when orchestrator instructions are too long, and LLM context windows are consumed by redundant text.

**Independent Test**: Can be tested by measuring orchestrator response time before/after refactoring on identical requests.

**Acceptance Scenarios**:

1. **Given** orchestrator.md is under 800 lines, **When** a developer requests "implement health endpoint", **Then** orchestrator classifies intent and routes to agent within 30 seconds
2. **Given** orchestrator.md has Intent Gate at top, **When** a trivial request arrives, **Then** orchestrator skips complex workflow analysis and routes directly
3. **Given** orchestrator.md has Decision Matrix, **When** keyword "fix bug" is detected, **Then** orchestrator routes to quick-fixer without reading full workflow patterns

---

### User Story 2 - Blocking Requirements Easily Found (Priority: P1)

A developer or agent reads an agent file and immediately sees all blocking requirements consolidated at the top (Blocking Gates section), rather than hunting through scattered "MANDATORY" markers.

**Why this priority**: Current agent files have critical requirements scattered throughout, leading to missed governance steps and rework.

**Independent Test**: Can be tested by verifying all blocking requirements are in first 100 lines of each agent file.

**Acceptance Scenarios**:

1. **Given** orchestrator.md has Blocking Gates section, **When** reading the file, **Then** all halt conditions are visible in first 100 lines
2. **Given** implementation-specialist.md has Blocking Gates, **When** agent starts work, **Then** it can verify all prerequisites from one section
3. **Given** code-reviewer.md has Blocking Gates, **When** review begins, **Then** validation checks are consolidated, not scattered

---

### User Story 3 - Quick Request Routing via Decision Matrix (Priority: P2)

A developer's request is routed to the correct agent using a quick lookup table (Decision Matrix) rather than parsing verbose decision trees.

**Why this priority**: OmO's Decision Matrix pattern enables fast routing without reading full workflow documentation.

**Independent Test**: Can be tested by verifying common request types route correctly using only the Decision Matrix.

**Acceptance Scenarios**:

1. **Given** orchestrator has Decision Matrix, **When** request contains "fix bug", **Then** routes to quick-fixer without parsing decision tree
2. **Given** Decision Matrix has 15+ common patterns, **When** standard requests arrive, **Then** 80% route via matrix lookup
3. **Given** Decision Matrix is under 50 lines, **When** orchestrator loads, **Then** routing logic fits in quick reference

---

### User Story 4 - Trivial Tasks Skip Governance Overhead (Priority: P2)

A developer requests a trivial task (<10 min, 1 file). The agent completes it without requiring Linear issue creation, changelog entries, or Context Steward validation.

**Why this priority**: Current agents require full governance for all tasks, creating unnecessary overhead for simple changes.

**Independent Test**: Can be tested by requesting a trivial task and verifying no governance prompts appear.

**Acceptance Scenarios**:

1. **Given** task is classified as TRIVIAL (<10 min, 1 file), **When** agent processes request, **Then** no Linear issue required
2. **Given** task is TRIVIAL, **When** agent completes work, **Then** no changelog entry required
3. **Given** task is SMALL (10-30 min, 2-3 files), **When** agent processes request, **Then** Linear comment only (no new issue)

---

### User Story 5 - Agents Reference Shared Instructions (Priority: P3)

A developer maintains agent files and finds that common patterns (Linear integration, governance gates, context handoff) are extracted to shared instruction files, reducing duplication.

**Why this priority**: DRY principle - current agents duplicate Linear patterns, governance patterns, and handoff patterns.

**Independent Test**: Can be tested by verifying agents reference shared files instead of duplicating content.

**Acceptance Scenarios**:

1. **Given** shared instruction `linear-integration.md` exists, **When** agent needs Linear patterns, **Then** it references shared file
2. **Given** shared instruction `governance-gates.md` exists, **When** agent needs pre/post-flight patterns, **Then** it references shared file
3. **Given** 4 agents updated, **When** comparing total lines, **Then** reduction is 30-40% per agent

---

### Edge Cases

- What happens when Intent Gate cannot classify a request? → Ask ONE clarifying question (per OmO pattern)
- What happens when task size is ambiguous? → Default to SMALL (require Linear comment but not new issue)
- What happens when shared instruction file is missing? → Agent falls back to inline patterns with warning
- What happens when TRIVIAL task has security implications? → Override to SMALL/MEDIUM classification

---

## Requirements

### Functional Requirements

#### Intent Classification (OmO Pattern)

- **FR-001**: Orchestrator MUST classify intent before any action using Intent Gate pattern
  - Classification types: TRIVIAL, SIMPLE, COMPLEX, AMBIGUOUS
  - Intent Gate runs on EVERY message (not just first message)
  
- **FR-002**: Orchestrator MUST assess search scope BEFORE delegating to explore/research agents
  - Direct tools first (grep/glob/LSP)
  - Agent delegation only when direct tools insufficient

#### Research & Planning Routing (Merged from LIF-61)

- **FR-002a**: Intent Gate MUST include explicit RESEARCH pattern (before CODEBASE_INQUIRY)
  - Keywords: "research", "investigate", "explore", "analyze", "study"
  - Routes to: research agent (not project-guru)
  - Priority: Higher than CODEBASE_INQUIRY to prevent misrouting

- **FR-002b**: Intent Gate MUST include explicit PLANNING pattern
  - Keywords: "plan", "design", "architect", "strategy", "roadmap"
  - Routes to: product-strategist (requirements) or strategic-architect (technical)
  - Standalone planning, not just Phase 1 of NEW_FEATURE

- **FR-002c**: Decision Matrix MUST include research and planning agent mappings
  - "research X" → research agent
  - "investigate Y" → research agent  
  - "plan feature Z" → product-strategist
  - "design architecture for W" → strategic-architect

- **FR-002d**: Orchestrator MUST support Research workflow pattern
  - Research → (optional) Planning → Implementation
  - Research-to-planning handoff when research reveals need for formal planning

#### Blocking Gates (OmO Pattern)

- **FR-003**: Orchestrator MUST have Blocking Gates consolidated at top (first 100 lines)
  - All halt conditions in one section
  - Clear [BLOCKING] markers
  
- **FR-004**: All agents MUST have Blocking Gates section at top
  - Pre-flight validation consolidated
  - REFUSE conditions clearly listed

#### Decision Matrix (OmO Pattern)

- **FR-005**: Orchestrator MUST include Decision Matrix for quick routing
  - Common patterns: bug fix, feature, docs, review, etc.
  - Direct situation → action mapping (no verbose decision trees)

#### Task Size Classification

- **FR-006**: Agents MUST classify task size before applying governance
  - TRIVIAL: <10 min, 1 file, no architectural impact
  - SMALL: 10-30 min, 2-3 files, minor changes
  - MEDIUM: 30 min - 4 hours, multiple files
  - LARGE: >4 hours, architectural changes

- **FR-007**: TRIVIAL tasks MUST skip Linear/changelog requirements
  - No Linear issue creation
  - No changelog entry
  - No Context Steward validation

- **FR-008**: SMALL tasks MUST have reduced governance
  - Linear comment only (not new issue)
  - Optional changelog
  - Context Steward only for new folders

#### Shared Instructions

- **FR-009**: Common patterns MUST be extracted to `.opencode/instructions/`
  - `linear-integration.md` - Linear patterns shared across agents
  - `governance-gates.md` - Pre/post-flight patterns
  - `context-handoff.md` - How to pass context between agents
  - `decision-matrix.md` - Quick routing reference

- **FR-010**: Agents MUST reference shared instructions instead of duplicating
  - Use `See: .opencode/instructions/{file}.md` references
  - Maintain agent-specific customizations inline

#### Restructured Files

- **FR-011**: Orchestrator.md MUST be restructured following OmO patterns
  - Intent Gate section
  - Blocking Gates section
  - Decision Matrix section
  - Search Strategy section
  - Reduced examples (single template with variations)

- **FR-012**: Implementation-specialist.md MUST be simplified
  - Blocking Gates at top
  - Task size classification
  - Reference shared instructions
  - Remove verbose validation examples

- **FR-013**: Code-reviewer.md MUST be simplified
  - Consolidate 10 compliance checklists into reference
  - Blocking Gates at top
  - Task size classification

- **FR-014**: Quick-fixer.md MUST be simplified
  - Task size classification (most fixes are TRIVIAL/SMALL)
  - Reduced Linear obsession for trivial fixes
  - Blocking Gates at top

### Key Entities

- **Intent Gate**: Classification mechanism that runs on every message to determine task type
- **Blocking Gate**: Consolidated halt conditions at top of agent file
- **Decision Matrix**: Quick lookup table for routing decisions
- **Task Size**: Classification (TRIVIAL/SMALL/MEDIUM/LARGE) determining governance level
- **Shared Instruction**: Extracted common pattern file in `.opencode/instructions/`

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: Orchestrator instruction file under 800 lines (currently 2000+)
  - Measurement: `wc -l .opencode/agent/orchestrator.md`
  - Target: ≤800 lines (60% reduction)

- **SC-002**: Total agent instruction lines reduced by 50%+
  - Current: ~3,500 lines (orchestrator: 2000+, impl: 486, reviewer: 644, fixer: 222)
  - Target: ~1,500 lines total
  - Measurement: Sum of `wc -l` for all 4 agent files

- **SC-003**: All existing functionality preserved (no regressions)
  - Measurement: Manual testing of all workflow patterns
  - Verification: Each workflow pattern still works after refactoring

- **SC-004**: TRIVIAL tasks complete without governance prompts
  - Measurement: Request trivial task, verify no Linear/changelog prompts
  - Target: <30 seconds for trivial task completion

- **SC-005**: Intent Gate classifies requests before any action
  - Measurement: Every orchestrator response starts with classification
  - Verification: Check first action is always intent classification

- **SC-006**: Blocking Gates in first 100 lines of each agent
  - Measurement: `head -100 {agent}.md | grep -c "BLOCKING\|REFUSE"`
  - Target: All blocking conditions visible in first 100 lines

- **SC-007**: Decision Matrix provides routing for 80%+ of common requests
  - Measurement: Test 20 common request types against Decision Matrix
  - Target: 16+ route correctly via matrix lookup

---

## Implementation Phases

### Phase 1: Orchestrator Restructure (Primary)

1. Add Intent Gate section (from OmO)
2. Add Blocking Gates section (consolidated from scattered MANDATORY)
3. Add Decision Matrix (from OmO, adapted for our agents)
4. Add Search Strategy section (from OmO)
5. Remove repetitive examples (single template with variations)
6. Extract workflow patterns to separate reference

**Deliverable**: `orchestrator.md` ≤800 lines

### Phase 2: Shared Instructions

1. Create `.opencode/instructions/linear-integration.md`
2. Create `.opencode/instructions/governance-gates.md`
3. Create `.opencode/instructions/context-handoff.md`
4. Create `.opencode/instructions/decision-matrix.md`
5. Create `.opencode/instructions/task-size-classification.md`

**Deliverable**: 5 shared instruction files

### Phase 3: Agent Simplification

1. Restructure `implementation-specialist.md` (~300 lines target)
2. Restructure `code-reviewer.md` (~400 lines target)
3. Restructure `quick-fixer.md` (~150 lines target)
4. Add Blocking Gates to each
5. Add task size classification to each
6. Reference shared instructions

**Deliverable**: 3 simplified agent files

### Phase 4: Governance Optimization

1. Implement task size classification logic
2. Configure governance bypass for TRIVIAL tasks
3. Configure reduced governance for SMALL tasks
4. Test governance levels work correctly
5. Document override conditions

**Deliverable**: Working task size classification with appropriate governance

---

## Technical Notes

### OmO Source Reference

**File**: `src/agents/omo.ts` (778 lines total)

**Key Patterns to Adopt**:

1. **Intent Gate** (lines 10-55): Classify every request before acting
   - Task types: TRIVIAL, EXPLORATION, IMPLEMENTATION, ORCHESTRATION
   - Search scope assessment before agent delegation

2. **Blocking Gates** (lines 94-127): Clear halt conditions
   - [BLOCKING] markers for mandatory checks
   - Consolidated at top, not scattered

3. **Decision Matrix** (lines 729-747): Quick lookup table
   - Situation → Action mapping
   - No verbose decision trees

4. **Search Strategy** (lines 129-213): Assess before exploring
   - Direct tools first (grep/glob/LSP)
   - Agent levels based on scope

5. **Todo Management** (lines 57-92): Obsessive tracking
   - Use for ANY task with 2+ steps
   - Evidence requirements for completion

### Files to Modify

| File | Current Lines | Target Lines | Reduction |
|------|---------------|--------------|-----------|
| `.opencode/agent/orchestrator.md` | 2000+ | ~600 | 70% |
| `.opencode/agent/implementation-specialist.md` | 486 | ~300 | 38% |
| `.opencode/agent/code-reviewer.md` | 644 | ~400 | 38% |
| `.opencode/agent/quick-fixer.md` | 222 | ~150 | 32% |
| **Total** | ~3,500 | ~1,450 | **59%** |

### Files to Create

| File | Purpose | Est. Lines |
|------|---------|------------|
| `.opencode/instructions/linear-integration.md` | Shared Linear patterns | ~50 |
| `.opencode/instructions/governance-gates.md` | Pre/post-flight patterns | ~80 |
| `.opencode/instructions/context-handoff.md` | Context passing patterns | ~60 |
| `.opencode/instructions/decision-matrix.md` | Quick routing reference | ~40 |
| `.opencode/instructions/task-size-classification.md` | Size classification rules | ~50 |

### Preserve (Do Not Remove)

- All governance for MEDIUM/LARGE tasks
- Linear integration for significant work
- Changelog discipline for auditable changes
- Context Steward path validation for new folders
- Historian for audit trail on significant work

### Remove (Redundant Content)

- Repetitive examples showing same pattern multiple times
- Verbose decision trees (replace with Decision Matrix)
- Scattered MANDATORY markers (consolidate to Blocking Gates)
- Duplicate Linear integration instructions (extract to shared)
- Duplicate context handoff templates (extract to shared)

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Functionality regression | High | Test each workflow pattern before/after |
| Governance bypass abuse | Medium | Clear task size definitions, override logging |
| Shared instruction drift | Low | Single source of truth, version control |
| Agent confusion on new structure | Medium | Clear migration guide, consistent patterns |

---

## Dependencies

- None (internal refactoring only)

## Related Issues

- **LIF-61** (Merged): Improve orchestrator intent classification for research and planning agents
  - Status: Duplicate (merged into this issue)
  - Requirements incorporated into FR-002a through FR-002d

---

## Handoff Notes

**For Strategic Architect**:
- This is primarily a documentation/instruction refactoring task
- No code changes to TypeScript files
- Focus on agent instruction file restructuring
- OmO patterns in `src/agents/omo.ts` are the reference implementation

**For Implementation Specialist**:
- Work in phases (orchestrator first, then shared, then agents)
- Validate each phase before proceeding
- Test governance levels work correctly
- Preserve all existing functionality
