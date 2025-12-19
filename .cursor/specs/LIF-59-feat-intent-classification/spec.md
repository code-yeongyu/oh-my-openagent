# Add Intent Classification to OmO

**Linear Issue**: [LIF-59](https://linear.app/lifelogger/issue/LIF-59/add-intent-classification-to-omo)
**Created**: 2025-12-18
**Status**: In Progress
**Dependencies**: LIF-57 ✅, LIF-58 ✅

## Overview

Enhance OmO's intent classification to detect granular task types (TRIVIAL, BUG_FIX, ENHANCEMENT, NEW_FEATURE, REFACTOR, PERFORMANCE) and adjust workflow accordingly. This enables right-sized workflows for different task complexities.

## Background

**Current State**: OmO has a basic `<Intent_Gate>` section with 4 task types:
- TRIVIAL, EXPLORATION, IMPLEMENTATION, ORCHESTRATION

**Problem**: Same approach for all requests regardless of complexity. A trivial fix gets the same todo overhead as a major feature.

**Solution**: Enhance classification with:
1. More granular task types with keyword triggers
2. Workflow selection logic (direct → todos → spec)
3. Ambiguity handling (ask, don't guess)

## Task Types

| Type | Keywords | Approach |
|------|----------|----------|
| TRIVIAL | "quick", single file, known location | Direct tools, NO todos |
| BUG_FIX | "fix", "bug", "error", "broken" | Minimal todos (2-4), surgical fix |
| ENHANCEMENT | "add", "improve", "update" | Standard todos, may need spec |
| NEW_FEATURE | "new", "create", "implement" + scope | Spec workflow if >4h |
| REFACTOR | "refactor", "restructure", "clean up" | Plan first, then todos |
| PERFORMANCE | "slow", "optimize", "speed" | Profile → Plan → Implement |

## Requirements

### Functional Requirements

1. Classify user request on every message
2. Detect task type from keywords and context
3. Adjust workflow based on task type
4. Handle ambiguous requests with clarification

### Integration with LIF-58 (Spec Workflow)

- NEW_FEATURE (>4h) → Check for spec folder → Use spec workflow
- NEW_FEATURE (≤4h) → Direct todos, skip spec
- BUG_FIX → Always skip spec, use minimal todos

## Acceptance Criteria

- [ ] OmO classifies intent on every user request
- [ ] TRIVIAL tasks skip todo overhead
- [ ] BUG_FIX tasks use minimal todos (2-4)
- [ ] NEW_FEATURE tasks trigger spec workflow when >4h
- [ ] Ambiguous requests prompt for clarification
- [ ] Enhanced `<Intent_Gate>` section with workflow selection
- [ ] `<Decision_Matrix>` updated with task type triggers
