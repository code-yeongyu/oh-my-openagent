---
name: creating-changes
description: "Use after brainstorming to write design document and task breakdown. Creates proposal.md, design.md, tasks.md, findings.md, and progress.md in the change directory."
---

# Creating Changes

## When to Use This Skill

Trigger when:
- Brainstorming skill has completed (conversation exploration done)
- Ready to create change directory and write all planning documents
- User has approved the design direction

## Not For / Boundaries

- Initial requirements gathering (use brainstorming first for conversation)
- Actual implementation (use executing-plans after this)
- Simple bug fixes (skip planning for trivial changes)

## Overview

After brainstorming has explored requirements through conversation, this skill creates the change directory and writes all 5 planning documents: proposal, design, tasks, findings, and progress.

**Announce at start:** "I'm using the creating-changes skill to create the change directory and write all planning documents."

## The Process

### Step 1: Create Change Directory

1. **Determine Change Name**: kebab-case, verb prefix (`add-`, `fix-`, `update-`, `refactor-`)
2. **Create Directory**: `changes/<name>/`
3. **Update boulder.json**: Set `currentChange` to the change name

### Step 2: Write proposal.md

Create `changes/<name>/proposal.md` following the template in `reference.md`.

Key sections:
- Problem Statement (what issue are we solving)
- Proposed Solution (high-level approach)
- Success Criteria (how we know it's done)
- Risk Assessment (potential issues)
- Alternatives Considered (other approaches evaluated)

### Step 3: Write design.md

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

### Step 4: Write tasks.md

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

### Step 5: Write findings.md

Create `changes/<name>/findings.md` to track research and discoveries.

Key sections:
- Requirements (captured from brainstorming)
- Research Findings (discoveries during exploration)
- Technical Decisions (choices made with rationale)
- Issues Encountered (problems found)
- Resources (links, docs, references)
- Visual/Browser Findings (if UI work involved)

**2-Action Rule:** After every 2 browser/view operations, save findings to this file.

**IMPORTANT: Use Edit to APPEND**
- When updating findings.md during execution, ALWAYS use Edit tool to APPEND content
- NEVER use Write tool on existing findings.md - it will OVERWRITE and DESTROY existing content

### Step 6: Write progress.md

Create `changes/<name>/progress.md` to track execution progress.

Key sections:
- Session log (date, what was worked on)
- Phase progress (which phases complete)
- Actions taken (bullet list of work done)
- Test Results (pass/fail status)
- Error Log (issues encountered)
- 5-Question Reboot Check (for session recovery)

**IMPORTANT: Use Edit to APPEND**
- When updating progress.md during execution, ALWAYS use Edit tool to APPEND content
- NEVER use Write tool on existing progress.md - it will OVERWRITE and DESTROY existing content

### Step 7: Update Status

Update `.sisyphus/boulder.json`:

```json
{
  "currentChange": "<name>",
  "startedAt": "<ISO timestamp>",
  "phase": "ready",
  "proposal_path": "changes/<name>/proposal.md",
  "design_path": "changes/<name>/design.md",
  "tasks_path": "changes/<name>/tasks.md"
}
```

## Completion

Report:

"Change directory created: `changes/<name>/`

Files created:
- `proposal.md`: Problem statement and solution approach
- `design.md`: Technical architecture and decisions
- `tasks.md`: [N] tasks across [M] phases
- `findings.md`: Research and discovery log
- `progress.md`: Execution progress tracker

Ready for implementation."

## Next Step

After creating all planning documents, select execution mode based on task count:

| Condition | Next Skill | Action |
|-----------|------------|--------|
| Task count ≤ 5 | `executing-plans` | `skill("executing-plans")` for sequential execution |
| Task count > 5 | `wave-parallel-execution` | `skill("wave-parallel-execution")` for parallel waves |

**Auto-Selection Logic:**
- Count tasks in `tasks.md`
- Announce: "Task count: [N] → Using [Sequential/Wave-Parallel] mode"
- User can override with "use sequential" or "use parallel"

**REQUIRED:** Invoke the appropriate execution skill after planning is complete.

## Key Principles

- **Exact file paths always** - No ambiguity about what to create/modify
- **Acceptance over implementation** - Define "done", not "how"
- **Risk tier on every task** - Enables TDD enforcement
- **DRY, YAGNI** - No unnecessary tasks or over-engineering
- **Phase independence** - Each phase should be deployable if possible
- **Front-load risk** - Put risky tasks early for early validation

## References

- `reference.md`: Templates for design.md and tasks.md with full examples
