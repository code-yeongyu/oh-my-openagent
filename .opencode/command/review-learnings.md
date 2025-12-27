---
description: Review and approve/reject meta-learning candidates
argument-hint: "[--category <type>] [--min-confidence <0-1>]"
---

# Review Learnings Command

Displays pending meta-learning candidates from `context/learnings/` and guides you through approving or rejecting each one.

## What This Does

1. Scans `context/learnings/*.md` for pending candidates
2. Displays each candidate with evidence and suggested improvement
3. Prompts for approve/reject decision
4. Updates candidate status in the file
5. Suggests next steps for approved candidates

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `--category` | Filter by category (agent_instructions, commands, orchestration, context_handling, tool_usage) | all |
| `--min-confidence` | Minimum confidence score (0-1) | 0.5 |

## Review Flow

For each pending candidate:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 Candidate: Improve delegation to explore agent
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Category: orchestration
Confidence: 0.85
Scope: When searching for files in unknown locations

Claim:
  OmO should use explore agent for file discovery before
  attempting direct grep/glob searches.

Evidence:
  - Session showed 3 failed grep attempts before delegation
  - Explore agent found files in 1 try

Suggested Improvement:
  Update OmO prompt to prioritize explore agent for
  "find files" queries when location is unknown.

Affected Files:
  - src/agents/omo.ts

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Action: [A]pprove / [R]eject / [S]kip / [Q]uit
```

## Usage Examples

```bash
# Review all pending candidates
/review-learnings

# Review only orchestration improvements
/review-learnings --category orchestration

# Review high-confidence candidates only
/review-learnings --min-confidence 0.8
```

## After Approval

For approved candidates:

1. **Simple Fix**: Implement directly
2. **Complex Change**: Run `/specify` to create a feature spec
3. **Needs Discussion**: Add to Linear backlog

## Candidate Statuses

| Status | Meaning |
|--------|---------|
| `pending` | Awaiting review |
| `approved` | Marked for implementation |
| `rejected` | Dismissed (with reason) |

## Files Modified

- `context/learnings/*.md` - Updates status field in candidates
