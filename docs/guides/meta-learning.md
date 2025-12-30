---
title: "Meta-Learning System"
description: "User guide for the self-improving meta-learning system that extracts insights from development sessions."
---

# Meta-Learning System

OhMyOpenCode features a self-improving system that analyzes your development sessions for quality patterns and improvement opportunities. The system extracts structured learnings that can be reviewed, approved, and implemented to continuously enhance OmO orchestration.

## Quick Start

### 1. Enable the System

The meta-learning extractor is enabled by default. Verify or configure in `oh-my-opencode.json`:

```json
{
  "meta_learning": {
    "enabled": true
  }
}
```

### 2. Work Normally

The system monitors your sessions automatically. High-value patterns trigger extraction when:
- Session goes idle (no activity)
- Context compaction is triggered
- You manually request extraction

### 3. Review Learnings

```
/review-learnings
```

Review extracted candidates, approve improvements, and implement them via `/specify`.

---

## How It Works

### Automatic Triggers

| Trigger | When | Purpose |
|---------|------|---------|
| `session.idle` | After inactivity | Background extraction during idle time |
| `experimental.session.compacting` | Before context loss | Capture learnings before history is compacted |
| `manual` | `/extract-learnings` | On-demand extraction via command |

### Signal Scoring

The system monitors session activity and assigns points based on conversation quality. Extraction triggers when the total score reaches the threshold (default: 3 points).

| Signal Type | Points | Examples |
|-------------|--------|----------|
| **Strong** | +3 | Memory file edits, shared utilities, architecture changes, cross-file refactoring |
| **Medium** | +2 | Decision language ("decided to...", "chose X over Y"), pattern identification, cross-file impact |
| **Weak** | +1 | New file types, config changes, dependency changes |

### Vetoes (Blocks Extraction)

Extraction is automatically suppressed for:
- Single file changes only
- Environment-specific configurations
- Speculative or exploratory conversations
- Sessions with fewer than 5 messages

---

## Commands

### `/extract-learnings`

Manually trigger meta-learning extraction from the current session.

```
/extract-learnings
```

**What it does**:
1. Calls `extract_learnings` tool to capture/validate transcript (secrets auto-redacted)
2. Writes transcript to `context/transcripts/{session_id}.jsonl`
3. Delegates to `context-learner` agent via `background_task` for iterative analysis
4. Agent uses grep/read to analyze large transcripts without context overflow
5. Outputs candidates to `context/learnings/`

**Use when**:
- You've completed a valuable task and want to capture insights
- Session has high-quality patterns worth preserving
- Before ending a particularly productive session

---

### `/review-learnings`

Review and approve/reject pending meta-learning candidates.

```bash
# Review all pending candidates
/review-learnings

# Filter by category
/review-learnings --category orchestration

# Filter by confidence
/review-learnings --min-confidence 0.8
```

**Arguments**:

| Argument | Description | Default |
|----------|-------------|---------|
| `--category` | Filter by category type | all |
| `--min-confidence` | Minimum confidence score (0-1) | 0.5 |

**Review flow**:

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

---

## Meta-Learning Categories

| Category | What It Improves | Example Finding |
|----------|------------------|-----------------|
| `agent_instructions` | Agent prompts, roles, capabilities | "OmO should delegate frontend work earlier" |
| `commands` | Slash command behavior, workflows | "/implement should check for tasks.md first" |
| `orchestration` | Delegation patterns, agent selection | "Use explore agent for file discovery before implementation" |
| `context_handling` | Memory management, compaction timing | "Extract learnings at 60% context, not 80%" |
| `tool_usage` | Tool selection, efficiency | "Use LSP goto_definition instead of grep for symbol lookup" |

---

## Output Format

Learnings are saved to `context/learnings/{session_id}_{date}.md`:

```markdown
# Meta-Learning Candidates

## Metadata
- Session: abc12345
- Trigger: idle
- Timestamp: 2025-01-15T10:30:00Z
- Signal Score: 7

## Candidates

### 1. Improved Tool Selection for Refactoring
- **Category**: orchestration
- **Claim**: Agent should prefer ast_grep_replace over multi-file Edit for renames
- **Confidence**: 0.92
- **Scope**: When performing bulk symbol renames across 5+ files
- **Status**: pending

**Evidence**:
1. Session involved 15 manual edits that failed due to context limits
2. ast_grep_replace completed the same task in one call

**Suggested Improvement**: Update orchestration policy to favor AST tools for bulk changes

**Affected Files**: src/shared/delegation-policy.ts

---

### 2. Earlier Delegation to Frontend Specialist
- **Category**: agent_instructions
- **Claim**: OmO should delegate UI work to frontend-ui-ux-engineer earlier in the workflow
- **Confidence**: 0.78
- **Scope**: When implementing features with UI components
- **Status**: pending

**Evidence**:
1. OmO attempted 3 UI fixes before delegating
2. Frontend agent completed task on first attempt

**Suggested Improvement**: Add heuristic in OmO to detect UI-heavy tasks and delegate immediately

**Affected Files**: src/agents/omo.ts

## Extraction Notes
- Total Candidates: 2
- High Confidence (>0.8): 1
- Medium Confidence (0.5-0.8): 1
```

---

## Review Workflow

### Standard Flow

1. **Run `/review-learnings`** to see pending candidates
2. **For each candidate**:
   - **Approve**: Mark for implementation
   - **Reject**: Dismiss with reason
   - **Skip**: Review later
3. **For approved candidates**:
   - Simple fix → Implement directly
   - Complex change → Run `/specify` to create feature spec
   - Needs discussion → Add to Linear backlog

### Candidate Statuses

| Status | Meaning |
|--------|---------|
| `pending` | Awaiting review |
| `approved` | Marked for implementation |
| `rejected` | Dismissed (with reason) |

---

## Configuration

Configure in `oh-my-opencode.json`:

```json
{
  "meta_learning": {
    "enabled": true,
    "signal_threshold": 3,
    "cooldown_minutes": 30,
    "context_threshold_percent": 60,
    "max_candidates_per_session": 3,
    "min_confidence": 0.5,
    "max_extractions_per_day": 10,
    "storage_path": "context/learnings/"
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `true` | Enable or disable the meta-learning system |
| `signal_threshold` | `3` | Score required to trigger extraction (0-10) |
| `cooldown_minutes` | `30` | Minutes to wait between extractions per session |
| `context_threshold_percent` | `60` | Context usage % to trigger extraction (0-100) |
| `max_candidates_per_session` | `3` | Max learnings to extract per run (1-10) |
| `min_confidence` | `0.5` | Minimum confidence score for candidates (0-1) |
| `max_extractions_per_day` | `10` | Maximum extractions per day (budget control) |
| `storage_path` | `"context/learnings/"` | Directory for learning output |

### Budget & Cooldown

| Control | Default | Description |
|---------|---------|-------------|
| Daily Budget | 10 extractions | Maximum extractions per day across all sessions |
| Cooldown | 30 minutes | Minimum time between extractions per session |
| Context Threshold | 60% | Triggers extraction when context usage exceeds this % |
| Extraction Cost | ~$0.05 | Estimated cost per analysis (Gemini Flash 2.5) |

---

## Best Practices

### 1. Review Regularly

Check learnings weekly:
```
/review-learnings
```

Accumulated insights improve OmO over time.

### 2. Filter by Category

When focusing on specific improvements:
```
/review-learnings --category orchestration
/review-learnings --category tool_usage
```

### 3. High-Confidence First

Review most confident candidates first:
```
/review-learnings --min-confidence 0.8
```

### 4. Create Specs for Complex Changes

Don't implement complex improvements directly. Use the workflow:
```
# After approving a complex candidate
/specify Improve OmO delegation for frontend tasks
```

### 5. Track Implementations

After implementing an approved learning:
1. Update the candidate status to `implemented`
2. Note the commit/PR reference
3. Monitor for actual improvement

---

## Troubleshooting

### No learnings extracted

**Possible causes**:
- Session below message threshold (< 5 messages)
- Signal score below threshold
- In cooldown period
- Daily budget exhausted

**Solutions**:
- Wait for more substantial session activity
- Use `/extract-learnings` for manual extraction
- Check config for custom thresholds

### Extraction not triggering automatically

**Check**:
1. Hook is enabled in config
2. Session has enough activity (signal score)
3. Not in cooldown (30 min default)
4. Daily budget not exhausted

### Low-quality candidates

**Adjust**:
- Increase `minConfidence` threshold
- Lower `maxCandidatesPerSession` to focus on best insights
- Increase `signalThreshold` to only trigger on high-value sessions

### Budget exhausted too quickly

**Adjust**:
- Increase `max_extractions_per_day` if needed
- Increase `cooldown_minutes` to reduce frequency
- Increase `signal_threshold` to be more selective

---

## Limitations

| Limitation | Description | Workaround |
|------------|-------------|------------|
| Budget Reset on Reload | Daily extraction counter resets when plugin reloads | Counter is per-session; will be persisted in future version |
| Secret Redaction | Some patterns may not be caught | Review output files for sensitive data |

---

## Technical Details

For architecture and implementation details, see:
- [Architecture: Hook System](/architecture/04-hook-system)
- [Architecture: Agent System](/architecture/02-agent-system)

### Components

| Component | Purpose |
|-----------|---------|
| `meta-learning-extractor` hook | Monitors sessions, triggers extraction |
| `context-learner` agent | Analyzes sessions, generates candidates |
| Signal scorer | Computes extraction worthiness |
| Secret redactor | Removes sensitive data before analysis |

### Files

| Path | Purpose |
|------|---------|
| `src/hooks/meta-learning-extractor/` | Hook implementation |
| `src/agents/context-learner.ts` | Analysis agent |
| `context/learnings/*.md` | Output files |

---

## Summary

The meta-learning system provides:
- ✅ **Automatic insights**: Extracts learnings during idle time
- ✅ **Manual control**: `/extract-learnings` for on-demand extraction
- ✅ **Review workflow**: `/review-learnings` for approval process
- ✅ **Budget control**: Configurable spending limits
- ✅ **Quality filtering**: Confidence thresholds and vetoes

Start with defaults, review learnings weekly, and watch OmO improve over time!
