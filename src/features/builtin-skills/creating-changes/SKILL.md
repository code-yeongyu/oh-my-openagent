---
name: creating-changes
description: "Use after brainstorming to write design document and task breakdown. Creates design.md and tasks.md in the change directory."
---

# Creating Changes

## When to Use This Skill

Trigger when:
- Brainstorming skill has completed
- Change directory exists with `proposal.md`
- Ready to write technical design and task breakdown

## Not For / Boundaries

- Initial requirements gathering (use brainstorming first)
- Actual implementation (use executing-plans after this)
- If proposal.md is missing, go back to brainstorming skill

## Overview

After brainstorming has created the change directory and proposal, this skill writes the technical design document and breaks down the work into actionable tasks.

**Announce at start:** "I'm using the creating-changes skill to write design and task breakdown."

## Prerequisites

Before using this skill, ensure:

1. Change directory exists: `changes/<name>/`
2. `proposal.md` is complete (created by brainstorming skill)
3. `.fusion/status.json` has `currentChange` set

## The Process

### Step 1: Review Proposal

Read `changes/<name>/proposal.md` to understand:
- Why this change is needed
- What will be modified
- Success criteria
- Risk tier

### Step 2: Write design.md

Create `changes/<name>/design.md` following the template in `reference.md`.

Key sections:
- Goal (derived from proposal)
- Architecture (technical approach, components, data flow)
- Tech Stack (runtime, libraries, testing)
- File Structure (planned file changes)
- Key Decisions (choices and rationale)
- Edge Cases (known edge cases and handling)
- Open Questions (unresolved items)

**Codex Collaboration (optional):**

For complex designs, invoke Codex for validation:

```
mcp_codex_codex({
  PROMPT: "请审查以下技术设计，识别潜在问题和改进建议:\n\n{design_content}",
  cd: "{project_root}",
  sandbox: "read-only"
})
```

### Step 3: Write tasks.md

Create `changes/<name>/tasks.md` with detailed, actionable tasks. Each task specifies:
- Exact file paths (create/modify/test)
- Clear acceptance criteria
- TDD test case descriptions
- Risk tier label
- Dependencies on other tasks

See `reference.md` for the complete task template format.

**Task Granularity:**
- Each task: 2-5 minutes of focused work
- Single responsibility per task
- Independently verifiable with clear acceptance

**DO NOT include full implementation code** - that's for executing-plans.

**DO include:**
- Exact file paths
- Detailed acceptance criteria (specific, measurable)
- TDD test case descriptions with expected behaviors
- Edge cases to handle
- Risk tier label
- Task dependencies

### Step 4: Update Status

Update `.fusion/status.json`:

```json
{
  "currentChange": "<name>",
  "startedAt": "<ISO timestamp>",
  "phase": "ready",
  "tasks": {}
}
```

## Completion

Report:

"Design and tasks complete for `changes/<name>/`:
- `design.md`: Technical architecture and decisions
- `tasks.md`: [N] tasks across [M] phases

Ready for implementation."

## Next Step: Choose Execution Method

Ask the user:

"Please choose execution method:

**1. Sequential (推荐小型任务)**
→ 自动创建单个 worktree
→ 逐个任务执行，每任务自动 git checkpoint
→ 适合：< 5 个任务，依赖关系复杂
→ **REQUIRED SUB-SKILL:** Use superpowers:executing-plans

**2. Wave-Parallel (推荐复杂任务)**
→ 自动分析任务依赖，分组为 Waves
→ 为每个 Wave 创建独立 worktree
→ Wave 间并行执行
→ 适合：> 5 个任务，有可并行的任务组
→ **REQUIRED SUB-SKILL:** Use superpowers:wave-parallel-execution

**注意**: 两个选项都会自动创建 worktree，无需单独选择。

Please choose 1 or 2."

## Key Principles

- **Exact file paths always** - No ambiguity about what to create/modify
- **Acceptance over implementation** - Define "done", not "how"
- **Risk tier on every task** - Enables TDD enforcement
- **DRY, YAGNI** - No unnecessary tasks or over-engineering
- **Phase independence** - Each phase should be deployable if possible
- **Front-load risk** - Put risky tasks early for early validation

## References

- `reference.md`: Templates for design.md and tasks.md with full examples
