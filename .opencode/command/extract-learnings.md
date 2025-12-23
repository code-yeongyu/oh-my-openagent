---
description: Manually trigger meta-learning extraction from current session
agent: context-learner
subtask: true
---

# Extract Learnings Command

Analyzes the current session for opportunities to improve OmO orchestration, delegation patterns, and tool usage.

## What This Does

1. Computes signal score from session activity
2. Serializes conversation context (with secrets redacted)
3. Delegates to `context-learner` agent for analysis
4. Outputs meta-learning candidates to `context/learnings/`

## Meta-Learning Categories

| Category | What It Improves | Example Finding |
|----------|------------------|-----------------|
| `agent_instructions` | Agent prompts, roles, capabilities | "OmO should delegate frontend work earlier" |
| `commands` | Slash command behavior, workflows | "/implement should check for tasks.md first" |
| `orchestration` | Delegation patterns, agent selection | "Use explore agent for file discovery" |
| `context_handling` | Memory management, compaction | "Extract learnings before 70% context" |
| `tool_usage` | Tool selection, efficiency | "Use LSP instead of grep for symbols" |

## Output Format

Creates `context/learnings/{session_id}_{date}.md` with:

```markdown
# Meta-Learning Candidates

## Metadata
- Session: abc12345
- Trigger: manual
- Signal Score: 7/10

## Candidates

### 1. [Title]
- **Category**: orchestration
- **Claim**: [What should change in OmO]
- **Confidence**: 0.85
- **Scope**: [When this applies]
- **Evidence**: [Conversation excerpts]
- **Suggested Improvement**: [Actionable change]
- **Affected Files**: [File paths]
```

## Usage

```
/extract-learnings
```

No arguments needed - analyzes current session automatically.

## Quality Guidelines

- Maximum 3 candidates per extraction
- Minimum confidence threshold: 0.5
- Evidence-based only, no speculation
- Specific improvements, not vague suggestions

## Next Steps

After extraction:
1. Run `/review-learnings` to approve/reject candidates
2. Approved candidates can be turned into feature specs via `/specify`
