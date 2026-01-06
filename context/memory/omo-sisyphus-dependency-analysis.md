# OmO to Sisyphus Migration: Dependency Graph Analysis

**Analysis Date**: 2026-01-06
**Analyzed File**: `src/agents/omo.ts` (1144 lines, ~1125 lines of prompt)
**Purpose**: Architectural analysis for modular extraction

---

## Executive Summary

The OmO prompt is a **monolithic governance system** with 21 major sections spanning ~1125 lines. Analysis reveals:

1. **High coupling between governance sections** - Intent_Gate, Blocking_Gates, Todo_Management, and Decision_Matrix share vocabulary and enforce overlapping rules
2. **Implicit dependencies dominate** - Most cross-references are semantic (shared terminology) rather than explicit (named links)
3. **Central taxonomy problem** - Task types, scope levels, and workflow identifiers are defined in Intent_Gate but duplicated/referenced across 5+ sections
4. **Cyclic dependencies exist** - Notably Todo_Management ⇄ Spec_Workflow

---

## Section Inventory (21 Sections)

| # | Section | Lines | Line Count | Role |
|---|---------|-------|------------|------|
| 1 | `<Role>` | 5-8 | 4 | Identity definition |
| 2 | `<Intent_Gate>` | 10-182 | 173 | **Router/Classifier** - Task type determination |
| 3 | `<Todo_Management>` | 184-235 | 52 | **Policy** - Todo lifecycle enforcement |
| 4 | `<Blocking_Gates>` | 237-275 | 39 | **Governance** - Mandatory checkpoints |
| 5 | `<Search_Strategy>` | 277-361 | 85 | **Procedure** - Search framework |
| 6 | `<Oracle>` | 363-427 | 65 | **Capability** - Advisor integration |
| 7 | `<Delegation_Rules>` | 429-546 | 118 | **Protocol** - Subagent delegation |
| 8 | `<Implementation_Flow>` | 548-598 | 51 | **Workflow** - Code implementation |
| 9 | `<Exploration_Flow>` | 600-622 | 23 | **Workflow** - Discovery process |
| 10 | `<Playbooks>` | 624-672 | 49 | **Procedures** - Specialized workflows |
| 11 | `<Tools>` | 674-709 | 36 | **Reference** - Tool selection matrix |
| 12 | `<Parallel_Execution>` | 711-750 | 40 | **Pattern** - Background execution |
| 13 | `<Verification_Protocol>` | 752-775 | 24 | **Gate** - Completion requirements |
| 14 | `<Failure_Handling>` | 777-830 | 54 | **Policy** - Error recovery |
| 15 | `<Agency>` | 832-844 | 13 | **Behavior** - Initiative guidelines |
| 16 | `<Conventions>` | 846-861 | 16 | **Standards** - Code style |
| 17 | `<Anti_Patterns>` | 863-922 | 60 | **Constraints** - Forbidden practices |
| 18 | `<Decision_Matrix>` | 924-958 | 35 | **Quick Reference** - Situation router |
| 19 | `<Governance>` | 960-1003 | 44 | **Integration** - Linear/project org |
| 20 | `<Spec_Workflow>` | 1005-1110 | 106 | **Procedure** - Spec-driven tasks |
| 21 | `<Final_Reminders>` | 1112-1125 | 14 | **Summary** - Key principles |

---

## Dependency Graph

### Visual Representation

```
                    ┌─────────────────┐
                    │   <Role>        │ (Identity - standalone)
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  TAXONOMY       │ ◄── Implicit module (not explicit)
                    │  (Task Types,   │     Defines: TRIVIAL/EXPLORATION/
                    │   Scope Levels, │     IMPLEMENTATION/ORCHESTRATION,
                    │   Workflow IDs) │     BUG_FIX/ENHANCEMENT/etc.
                    └────────┬────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  <Intent_Gate>  │ │<Todo_Management>│ │<Decision_Matrix>│
│   (Router)      │ │   (Policy)      │ │  (Quick Ref)    │
└────────┬────────┘ └────────┬────────┘ └─────────────────┘
         │                   │                   ▲
         │  ┌────────────────┼───────────────────┤
         │  │                │                   │
         ▼  ▼                ▼                   │
┌─────────────────┐ ┌─────────────────┐          │
│<Blocking_Gates> │◄┤<Verification_   │          │
│  (Checkpoints)  │ │   Protocol>     │          │
└────────┬────────┘ └─────────────────┘          │
         │                                       │
    ┌────┴────┬────────────┬────────────┐       │
    ▼         ▼            ▼            ▼       │
┌───────┐ ┌───────┐ ┌───────────┐ ┌───────────┐│
│GATE 1 │ │GATE 3 │ │  GATE 4   │ │ GATE 2.5  ││
└───┬───┘ └───┬───┘ └─────┬─────┘ └─────┬─────┘│
    │         │           │             │      │
    ▼         ▼           ▼             ▼      │
┌───────────┐┌───────────┐┌───────────┐┌───────────┐
│<Search_   ││<Delegation││<Todo_Mgmt>││<Delegation│
│ Strategy> ││  _Rules>  ││+Verificatn││  _Rules>  │
└───────────┘└───────────┘└───────────┘└─────┬─────┘
                                             │
                                             ▼
                              ┌─────────────────────┐
                              │ frontend-ui-ux-     │
                              │ engineer (agent)    │
                              └─────────────────────┘

                 WORKFLOW SECTIONS
┌─────────────────────────────────────────────────────┐
│                                                     │
│  ┌──────────────┐      ┌──────────────┐            │
│  │<Intent_Gate> │─────►│ <Playbooks>  │            │
│  │  (Routes to) │      │ Bugfix Flow  │            │
│  └──────────────┘      │ Refactor Flow│            │
│         │              └──────────────┘            │
│         │                                          │
│         ▼              ┌──────────────┐            │
│  ┌──────────────┐ ◄───►│<Todo_Mgmt>   │ (CYCLE!)  │
│  │<Spec_Workflow>│     │              │            │
│  │ tasks.md→todo│      └──────────────┘            │
│  └──────────────┘                                  │
│                                                    │
└─────────────────────────────────────────────────────┘
```

---

## Detailed Dependency Analysis

### 1. Intent_Gate Dependencies

**Efferent (Outgoing) - What Intent_Gate references:**
| Target Section | Reference Type | Line Evidence |
|----------------|---------------|---------------|
| `<Todo_Management>` | Defines todo strategy | L26-34 (Sub-Type table) |
| `<Spec_Workflow>` | Workflow delegation | L115-125 |
| `<Playbooks>` | Procedure references | L113, L132 |
| `<Blocking_Gates>` | Enforcement link | L245-249 (GATE 1) |
| `<Search_Strategy>` | Tool taxonomy | L65-69, L277-361 |

**Afferent (Incoming) - What references Intent_Gate:**
| Source Section | Reference Type |
|----------------|---------------|
| `<Todo_Management>` | "from Intent_Gate" (L197) |
| `<Decision_Matrix>` | Mirrors task type routing |
| `<Implementation_Flow>` | Phase selection |
| `<Exploration_Flow>` | Flow selection |

**Key Finding**: Intent_Gate is a **fan-out hub** - it routes to many sections but is also the **source of truth** for taxonomy.

### 2. Todo_Management Dependencies

**Imports (Ce = 3-4):**
- `Intent_Gate`: Task type taxonomy
- `Spec_Workflow`: Tasks.md artifact existence
- `Implementation_Flow`: Phase model (implicit)
- `Verification_Protocol`: Evidence semantics (shared)

**Exports (Ca = 4):**
- `Blocking_Gates` (GATE 4)
- `Verification_Protocol`
- `Implementation_Flow`
- `Spec_Workflow`

**Instability**: I = Ce/(Ca+Ce) = 3/7 ≈ **0.43** (moderately stable)

**Cycle Detected**: `<Todo_Management>` ⇄ `<Spec_Workflow>`
- Todo references "tasks.md → todos conversion"
- Spec_Workflow references todo enforcement for completion

### 3. Blocking_Gates Dependencies

| Gate | Depends On | Self-Contained? |
|------|------------|-----------------|
| GATE 0: Command Execution | None | ✅ Yes |
| GATE 1: Pre-Search | `<Search_Strategy>` | ❌ No |
| GATE 2: Pre-Edit | None | ✅ Yes |
| GATE 2.5: Frontend Files | `<Delegation_Rules>` | ✅ Yes (explicit) |
| GATE 3: Pre-Delegation | `<Delegation_Rules>` (7-section) | ❌ No |
| GATE 4: Pre-Completion | `<Todo_Management>`, `<Verification_Protocol>` | ❌ No |

**Key Finding**: Only 3 of 6 gates are self-contained. The others require external definitions.

### 4. Decision_Matrix Dependencies

**Relationship**: Decision_Matrix is a **derived artifact** - it mirrors Intent_Gate routing logic in quick-reference form.

**Problem**: Currently maintained as separate source of truth, creating **drift risk**.

**Recommendation**: Auto-generate or lint Decision_Matrix from Intent_Gate + Blocking_Gates.

---

## Shared Vocabulary/Concepts

### Core Taxonomy (Defined in Intent_Gate, used everywhere)

| Concept | Definition Location | Used In |
|---------|---------------------|---------|
| Task Types: TRIVIAL, EXPLORATION, IMPLEMENTATION, ORCHESTRATION | L17-23 | Todo_Management, Decision_Matrix, Playbooks |
| Impl Sub-Types: BUG_FIX, ENHANCEMENT, NEW_FEATURE, REFACTOR, PERFORMANCE, SECURITY | L25-34 | Todo_Management, Playbooks, Decision_Matrix |
| Scope Levels: Tiny, Small, Medium, Large, Epic | L42-59 | Todo_Management, Spec_Workflow |
| Search Scope Bands | L70-75 | Search_Strategy, Blocking_Gates/GATE1 |

### Shared Terms (Semantic coupling)

| Term | Sections Using It | Consistency Risk |
|------|-------------------|------------------|
| "BLOCKING" | Intent_Gate, Todo_Management, Blocking_Gates, Verification_Protocol, Anti_Patterns | Medium |
| "evidence" | Todo_Management, Blocking_Gates, Verification_Protocol | High (undefined schema) |
| "spec folder" | Intent_Gate, Todo_Management, Spec_Workflow, Governance | Medium |
| "7-section prompt" | Blocking_Gates, Delegation_Rules | Low (explicit reference) |

---

## Topological Order for Modular Extraction

Based on dependency analysis, sections should be extracted in this order:

```
Layer 0: Foundation (No dependencies)
├── <Role>
├── <Conventions>
└── <Agency>

Layer 1: Taxonomy (Define shared vocabulary)
└── [NEW] Taxonomy Module
    ├── Task Types
    ├── Implementation Sub-Types
    ├── Scope Levels
    └── Search Scope Bands

Layer 2: Tool/Capability Definitions
├── <Tools>
├── <Oracle>
├── <Parallel_Execution>
└── [Tooling vocabulary for agents]

Layer 3: Router (Depends on L1, L2)
└── <Intent_Gate> (stripped to pure classification)

Layer 4: Governance Core (Depends on L3)
├── <Blocking_Gates>
├── <Search_Strategy>
└── <Delegation_Rules>

Layer 5: Workflow Procedures (Depends on L1, L3, L4)
├── <Playbooks>
├── <Implementation_Flow>
├── <Exploration_Flow>
└── <Spec_Workflow>

Layer 6: State/Policy (Depends on L1, L3, L5)
├── <Todo_Management>
├── <Verification_Protocol>
└── <Failure_Handling>

Layer 7: Constraints (Can reference all layers)
└── <Anti_Patterns>

Layer 8: Derived/Reference (Generated from above)
├── <Decision_Matrix>
├── <Governance>
└── <Final_Reminders>
```

---

## Critical Findings

### 1. Central Coupling Point: Taxonomy
- Task types defined once in Intent_Gate but **duplicated** in Todo_Management table (L197-208)
- Decision_Matrix mirrors same routing logic (drift risk)
- **Recommendation**: Extract taxonomy as explicit module, import everywhere

### 2. Cyclic Dependency: Todo ⇄ Spec
- `<Todo_Management>` references Spec_Workflow for tasks.md conversion
- `<Spec_Workflow>` references Todo rules for completion
- **Recommendation**: Break cycle by making Spec emit neutral `tasksList` artifact; Todo consumes it

### 3. Governance Fragmentation
- Blocking_Gates, Anti_Patterns, and Verification_Protocol all define "what must not happen"
- Enforcement is **soft** (prompt-following, not tool constraints)
- **Recommendation**: Unify into Governance bundle; promote critical gates to tool/hook enforcement

### 4. Decision_Matrix Drift Risk
- Maintained separately from Intent_Gate/Blocking_Gates
- No mechanism to ensure consistency
- **Recommendation**: Auto-generate or lint from authoritative sections

### 5. Evidence Schema Undefined
- "Evidence" referenced 15+ times across sections
- No formal definition of what constitutes valid evidence
- **Recommendation**: Create explicit Evidence schema in Todo_Management or shared module

---

## Extraction Feasibility Assessment

| Section | Extraction Difficulty | Reason |
|---------|----------------------|--------|
| `<Role>` | Easy | Standalone |
| `<Agency>` | Easy | Standalone |
| `<Conventions>` | Easy | Standalone |
| `<Tools>` | Easy | Reference only |
| `<Oracle>` | Easy | Self-contained capability |
| `<Parallel_Execution>` | Easy | Self-contained pattern |
| `<Playbooks>` | Medium | References taxonomy |
| `<Search_Strategy>` | Medium | References tools + agents |
| `<Delegation_Rules>` | Medium | References agent types |
| `<Intent_Gate>` | **Hard** | Central hub, many outputs |
| `<Blocking_Gates>` | **Hard** | Depends on 4+ sections |
| `<Todo_Management>` | **Hard** | Cyclic dependency |
| `<Spec_Workflow>` | **Hard** | Cyclic dependency |
| `<Decision_Matrix>` | **Hard** | Derived artifact |
| `<Anti_Patterns>` | Medium | Cross-cutting concerns |
| `<Verification_Protocol>` | Medium | Shared with Todo |

---

## Recommended Migration Strategy

### Phase 1: Extract Taxonomy (1-2h)
1. Create explicit `Taxonomy` module with task types, subtypes, scope levels
2. Update all sections to import from Taxonomy
3. Remove duplicate definitions

### Phase 2: Decouple Governance (2-4h)
1. Bundle: Blocking_Gates + Search_Strategy + Delegation_Rules + Verification_Protocol
2. Normalize references (explicit anchors)
3. Promote critical gates to tool enforcement where possible

### Phase 3: Break Cycles (2-4h)
1. Make Spec_Workflow emit `tasksList` artifact
2. Make Todo_Management consume artifact, not reference Spec section
3. Test for regressions

### Phase 4: Generate Decision_Matrix (1-2h)
1. Create generation script from Intent_Gate + Blocking_Gates
2. Add lint step to CI
3. Remove manual maintenance

### Phase 5: Module Interfaces (4-8h)
1. Define input/output contracts for each major section
2. Replace cross-references with interface calls
3. Validate consistency across modules

**Total Estimated Effort**: 10-20 hours for clean modular architecture

---

## Appendix: Cross-Reference Matrix

| Section | References | Referenced By |
|---------|------------|---------------|
| Intent_Gate | Todo, Spec, Playbooks, Search, Gates | Todo, Decision, Impl, Explore |
| Todo_Management | Intent, Spec, Impl | Gates, Verify, Impl, Spec |
| Blocking_Gates | Search, Delegation, Todo, Verify | Intent, Decision |
| Search_Strategy | (tools) | Intent, Gates |
| Delegation_Rules | (agents) | Gates |
| Playbooks | (taxonomy) | Intent |
| Spec_Workflow | (governance tools) | Intent, Todo |
| Verification_Protocol | (evidence) | Gates, Todo |
| Decision_Matrix | (all routing) | (none - derived) |
| Anti_Patterns | (all constraints) | (none - cross-cutting) |
