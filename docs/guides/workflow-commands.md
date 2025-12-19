---
title: "Workflow Commands Guide"
description: "User guide for using the spec-driven workflow system in OhMyOpenCode"
---

# Workflow Commands Guide

## Overview

OhMyOpenCode provides six workflow commands that guide you through feature development from specification to testing. The workflow system enforces prerequisites, tracks your progress, and helps you resume work after interruptions.

**Workflow Steps**:
```
/specify → /plan → /tasks → /implement → /review → /test
```

## Quick Start

### 1. Create a Feature Specification

```
/specify Add user authentication with JWT tokens
```

**What it does**:
- Creates a spec folder (e.g., `.cursor/specs/LIF-123-feat-user-auth/`)
- Generates `spec.md` with requirements template
- Sets up Linear integration (if configured)

**Output**:
- `spec.md` - Feature requirements and user stories

---

### 2. Create an Implementation Plan

```
/plan
```

**What it does**:
- ✅ Validates `spec.md` exists (blocks if missing)
- Creates technical architecture plan
- Defines data models, APIs, dependencies

**Output**:
- `plan.md` - Technical architecture and implementation steps

**Blocked Example**:
```
❌ Preflight blocked

Issues:
  ❌ Required artifact not found: spec.md

Fixes:
  → Run /specify to create spec.md
```

---

### 3. Break Down Into Tasks

```
/tasks
```

**What it does**:
- ✅ Validates `spec.md` and `plan.md` exist
- Creates task breakdown organized by user story
- Optionally creates Linear sub-issues

**Output**:
- `tasks.md` - Task table with estimates and status

---

### 4. Implement the Feature

```
/implement
```

**What it does**:
- ✅ Validates all prerequisite artifacts exist
- Implements features according to plan
- Creates implementation notes

**Output**:
- Source code files
- `implementation/` folder with notes

---

### 5. Review the Code

```
/review
```

**What it does**:
- ✅ Validates `spec.md` exists
- Performs comprehensive code review
- Checks functionality, quality, security

**Output**:
- `reviews/{date}-review.md` - Review findings

---

### 6. Write and Run Tests

```
/test
```

**What it does**:
- ✅ Validates `spec.md` exists
- Writes unit, integration, and acceptance tests
- Runs tests and reports results

**Output**:
- Test files
- `testing/test-plan.md` - Test strategy

---

## Session Continuity

### Resuming Work

If you stop mid-workflow and return later, the system remembers your progress:

```
/plan

## Preflight Validation

✅ Preflight passed

📋 Resuming from: Planning (1 steps complete, last updated 12/18/2025)

📁 Spec: .cursor/specs/LIF-123-feat-user-auth
🔗 Linear: LIF-123

---
## Command Instructions
...
```

**How it works**:
- Each command updates `workflow-state.json` when complete
- Next command loads this state and shows resume message
- You see: completed steps, last update time, current position

### Drift Detection

If you manually edit workflow artifacts, the system detects it:

```
⚠️ Preflight passed with warnings

Issues:
  ⚠️ spec.md changed since last workflow step

📋 Resuming from: Planning (1 steps complete, last updated 12/18/2025)
```

**What this means**:
- You edited `spec.md` outside the workflow
- Non-blocking warning - work continues
- Review changes to ensure workflow is still valid

## Linear Integration

### Automatic Issue Linking

If your branch contains a Linear issue ID (e.g., `hello/lif-123-feature`):
- Workflow automatically detects the issue
- Syncs workflow status with Linear
- Shows issue context in command output

### Status Sync

| Workflow Step | Linear Status |
|---------------|---------------|
| `/specify` | todo |
| `/plan` | in_progress |
| `/tasks` | in_progress |
| `/implement` | in_progress |
| `/review` | in_review |
| `/test` | in_review |

### Configuration

Set Linear policy via environment variable:

```bash
# Require Linear issue for all workflows
export OPENCODE_LINEAR_POLICY=required

# Warn if missing (default)
export OPENCODE_LINEAR_POLICY=optional

# Disable Linear integration
export OPENCODE_LINEAR_POLICY=off
```

## Command Help

### View All Commands

```
/help
```

Shows all commands organized by category:
- 📋 Workflow (Primary)
- ✅ Quality
- 🔀 Git & PR
- 🔍 Research & Analysis
- 🏗️ Project
- 🔧 Utilities

### View Workflow Chain

```
/help workflow
```

Shows the workflow progression with requirements:

```
# Workflow Chain

/specify → /plan → /tasks → /implement → /review → /test

## Steps

### /specify
Create or update the feature specification

- Produces: spec.md
- Linear: todo

### /plan
Create implementation plan from specification

- Requires: spec.md
- Produces: plan.md
- Linear: in_progress

...
```

## Common Scenarios

### Scenario 1: Starting a New Feature

```bash
# 1. Create branch from Linear issue
git checkout -b hello/lif-123-user-auth

# 2. Create specification
/specify Add JWT-based user authentication

# 3. Create plan
/plan

# 4. Break down tasks
/tasks

# 5. Implement
/implement

# 6. Review
/review

# 7. Test
/test
```

### Scenario 2: Resuming After Interruption

```bash
# System remembers where you left off
/implement

## Preflight Validation
✅ Preflight passed

📋 Resuming from: Implementation (3 steps complete, last updated 12/18/2025)

# Continue working...
```

### Scenario 3: Skipping a Step (Not Recommended)

The workflow enforces order - you can't skip prerequisites:

```bash
# Try to run /plan without /specify
/plan

❌ Preflight blocked

Issues:
  ❌ No spec folder found
  ❌ Required artifact not found: spec.md

Fixes:
  → Create spec folder with /specify
    Run: /specify
```

### Scenario 4: Working Without Linear

```bash
# Set policy to "off"
export OPENCODE_LINEAR_POLICY=off

# Workflow works without Linear
/specify Add user authentication
# Creates: 001-feat-user-authentication/spec.md

/plan
# Creates: 001-feat-user-authentication/plan.md
```

## Workflow State

### State File Location

`{spec-folder}/workflow-state.json`

**Example**: `.cursor/specs/LIF-123-feat-user-auth/workflow-state.json`

### State Contents

```json
{
  "currentStep": "plan",
  "completedSteps": ["specify"],
  "artifactHashes": {
    "spec.md": "a1b2c3d4...",
    "plan.md": "e5f6g7h8..."
  },
  "linearIssueId": "LIF-123",
  "linearStatus": "in_progress",
  "createdAt": "2025-12-18T10:00:00Z",
  "updatedAt": "2025-12-18T11:30:00Z",
  "lastCommand": "/plan"
}
```

### When State is Updated

State updates automatically when you complete a workflow step. The agent calls `update_workflow_state` tool after execution.

**You don't need to manually update state** - it happens transparently.

## Troubleshooting

### "No spec folder found"

**Problem**: Trying to run workflow command without spec folder

**Solution**: Run `/specify` first to create the spec folder

---

### "Required artifact not found: spec.md"

**Problem**: Missing prerequisite file

**Solution**: Go back and complete previous workflow steps:
- Missing `spec.md`? Run `/specify`
- Missing `plan.md`? Run `/plan`
- Missing `tasks.md`? Run `/tasks`

---

### "spec.md changed since last workflow step"

**Problem**: Drift detected - file was manually edited

**Solution**: This is a warning, not an error. Review your changes:
1. Check if manual edits are still valid
2. Continue with workflow (non-blocking)
3. If changes are significant, consider re-running previous steps

---

### Workflow state out of sync

**Problem**: `workflow-state.json` doesn't match reality

**Solution**: Delete the state file and restart workflow:
```bash
rm .cursor/specs/LIF-123-*/workflow-state.json
```

## Best Practices

### 1. Follow the Workflow Order

Don't skip steps - each step builds on the previous:
- `/specify` defines WHAT
- `/plan` defines HOW
- `/tasks` breaks down WHEN
- `/implement` executes
- `/review` validates
- `/test` verifies

### 2. Use Linear Issues

For team projects, use Linear integration:
- Clear ownership and tracking
- Automatic status sync
- Better context for agents

### 3. Keep Artifacts Updated

If you manually edit workflow artifacts:
- Update all dependent artifacts
- Re-run workflow steps if significant changes
- Don't ignore drift warnings

### 4. Review State Before Resuming

When resuming after a break:
- Check the resume message
- Verify completed steps align with reality
- Review any drift warnings

### 5. Use Descriptive Feature Names

Good:
```
/specify Add JWT authentication with refresh tokens
```

Bad:
```
/specify fix auth
```

Descriptive names help with:
- Spec folder organization
- Linear issue clarity
- Team communication

## Advanced Usage

### Custom Spec Folder Location

Workflow searches in:
1. `.cursor/specs/`
2. `context/specs/`

Choose your preferred location:
```bash
mkdir -p .cursor/specs    # OpenCode convention
# or
mkdir -p context/specs    # Alternative
```

### Manual Spec Folder Creation

If you want to create the structure manually:

```bash
mkdir -p .cursor/specs/LIF-123-feat-user-auth
cd .cursor/specs/LIF-123-feat-user-auth

# Create artifacts
touch spec.md plan.md tasks.md status.md
```

Then run workflow commands normally.

### Workflow State Tool (Advanced)

Agents can manually update state:

```typescript
update_workflow_state({
  specPath: ".cursor/specs/LIF-123-feat-auth",
  step: "implement",
  linearStatus: "in_progress"
})
```

**When to use**:
- Custom workflow steps
- Manual state correction
- Integration with external systems

## Summary

The workflow system provides:
- ✅ **Structure**: Clear progression from spec to test
- ✅ **Validation**: Blocks commands until prerequisites met
- ✅ **Continuity**: Resume work after interruptions
- ✅ **Tracking**: Automatic state persistence
- ✅ **Integration**: Syncs with Linear issues

Start with `/specify`, follow the workflow, and let the system guide you through feature development!

## Further Reading

- [Workflow System Architecture](/architecture/12-workflow-system) - Technical details
- [ADR-004: Workflow Command System](/architecture/decisions/ADR-004-workflow-command-system) - Design decisions
- [Governance System](/architecture/07-governance-system) - Path validation and historian
