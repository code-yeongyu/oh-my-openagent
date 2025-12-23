# Meta-Learning Extractor Hook

Extracts meta-learnings from sessions to enable self-improving orchestration. Monitors high-signal patterns and triggers the `context-learner` agent to persist structured improvement opportunities.

## Triggers

| Trigger | Event / Origin | Purpose |
|---------|----------------|---------|
| `session.idle` | Session inactivity | Background extraction during idle time |
| `experimental.session.compacting` | Context compaction | Capture learnings before history is lost |
| `manual` | `/extract-learnings` | On-demand extraction via command |

## Signal Scoring System

The hook monitors session activity and assigns points based on conversation quality. Extraction is triggered when the total score reaches the **25 point** threshold.

| Signal Type | Points | Examples |
|-------------|--------|----------|
| **Strong** | +15-20 | Debugging loops, architecture discussions, multi-agent coordination |
| **Medium** | +5-10 | Refactoring, config changes, complex tool chains |
| **Weak** | +2-3 | File modifications, code review patterns |

### Vetoes
Extractions are automatically suppressed for:
- Trivial conversations
- Short sessions (< 5 messages)
- Pure codebase exploration without modifications

## Budget & Cooldown

| Control | Value | Description |
|---------|-------|-------------|
| **Daily Budget** | $0.10 USD | Maximum daily spend across all sessions |
| **Cooldown** | 30 minutes | Minimum time between extractions per session |
| **Extraction Cost** | ~$0.01 | Estimated cost per analysis task |

## Output

Learnings are saved as structured Markdown files:
`context/learnings/{session_id}_{date}.md`

### Format Example
```markdown
# Meta-Learning Candidates

## Metadata
- Session: abc12345
- Trigger: idle
- Signal Score: 28

## Candidates
### 1. Improved Tool Selection for Refactoring
- **Category**: orchestration
- **Claim**: Agent should prefer ast_grep_replace over multi-file Edit for renames
- **Confidence**: 0.92
- **Evidence**: Session involved 15 manual edits that failed due to context limits
- **Suggested Improvement**: Update orchestration policy to favor AST tools for bulk changes
- **Affected Files**: src/shared/delegation-policy.ts
```

## Configuration

Configure via `oh-my-opencode.json`:

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `true` | Enable or disable the hook |
| `signalThreshold` | `25` | Score required to trigger extraction |
| `cooldownMinutes` | `30` | Minutes to wait between extractions |
| `dailyBudgetUsd` | `0.10` | Maximum daily spend (USD) |
| `maxCandidatesPerSession` | `3` | Max learnings to extract per run |
| `minConfidence` | `0.5` | Minimum confidence score for candidates |

## Related Components

- **Agent**: `context-learner` - The specialized agent that analyzes sessions.
- **Commands**:
  - `/extract-learnings`: Manually trigger the extraction process.
  - `/review-learnings`: Interactive command to review and apply extracted candidates.
