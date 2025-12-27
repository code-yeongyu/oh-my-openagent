---
description: Manually trigger meta-learning extraction from current session
argument-hint: "[transcript_path]"
---

# Extract Learnings

Analyze a session for meta-learning opportunities to improve OmO orchestration.

## Step 1: Get Transcript

Use `extract_learnings` tool to capture or validate the transcript:

```
# Capture current session (default)
extract_learnings()

# Use existing transcript file
extract_learnings({ transcript_path: "context/transcripts/ses_abc123.jsonl" })
```

## Step 2: Analyze with Context-Learner

After getting the transcript path, delegate analysis to context-learner:

```
background_task({
  agent: "context-learner",
  description: "Analyze session for meta-learnings",
  prompt: `TASK: Extract meta-learnings from transcript.

TRANSCRIPT: {transcript_path}
LINES: {line_count}

Analyze iteratively using grep/read tools:
1. grep for "error|fail|retry" to find problems
2. grep for "call_omo_agent|background_task" for delegation patterns
3. read specific sections with offset/limit

Write findings to: context/learnings/{session_id}_{date}.md

Categories: agent_instructions, commands, orchestration, context_handling, tool_usage
Max 3 candidates, min 0.5 confidence, evidence required.`
})
```

## User Arguments

If user provided a transcript path: `$ARGUMENTS`

Use that path with `extract_learnings({ transcript_path: "..." })` instead of capturing.

## Execute Now

1. Call `extract_learnings` (with user's transcript_path if provided)
2. On success, call `background_task` with context-learner using the returned transcript_path
