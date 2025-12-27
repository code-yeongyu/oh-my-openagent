export const EXTRACT_LEARNINGS_NAME = "extract_learnings"

export const EXTRACT_LEARNINGS_DESCRIPTION = `Trigger meta-learning extraction from the current session.

This tool:
1. Captures the full session transcript (survives compaction)
2. Writes it to context/transcripts/{session_id}.jsonl
3. Delegates to context-learner agent for iterative analysis
4. Outputs learnings to context/learnings/

The context-learner agent can analyze massive sessions by:
- Using grep to search for patterns (errors, retries, delegation issues)
- Using read with offset/limit to examine specific sections
- Building insights iteratively without context overflow

Use this after substantive work sessions to extract improvement opportunities.`

export const DEFAULT_TRANSCRIPT_PATH = "context/transcripts"
export const DEFAULT_LEARNINGS_PATH = "context/learnings"
