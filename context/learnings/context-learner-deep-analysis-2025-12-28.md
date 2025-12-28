# Deep Analysis: Context-Learner Agent Improvements

**Date**: 2025-12-28
**Analysis Type**: Multi-agent parallel exploration (8 agents)
**Issue**: LIF-74 - Context-learner made incorrect inferences from incomplete transcript

---

## Executive Summary

The context-learner agent made incorrect inferences because:
1. **Transcript capture gap**: User message `parts` are NOT captured (only `msg.info.content`)
2. **Text part property mismatch**: Code checks `part.content` but actual property is `part.text`
3. **No data quality validation**: Agent proceeds with analysis without verifying transcript completeness
4. **No uncertainty expression**: Agent lacks explicit instructions to acknowledge data limitations

---

## Issue 1: Transcript Capture Gaps

### Problem Location
**File**: `src/tools/extract-learnings/tools.ts` (lines 49-113)

### Root Cause
The `serializeToTranscript` function has TWO critical bugs:

#### Bug 1: User message parts ignored (lines 56-65)
```typescript
// CURRENT CODE - Only captures msg.info.content, ignores parts
if (role === "user" && msg.info?.content) {
  const content = typeof msg.info.content === "string"
    ? msg.info.content
    : JSON.stringify(msg.info.content)
  entries.push({ type: "user", timestamp, content })
}
// BUG: msg.parts is NEVER checked for user messages!
```

**Evidence**: User messages CAN have parts, as shown in:
- `user-prompt-submit.ts` line 23: `parts: MessagePart[]`
- `keyword-detector/detector.ts` lines 18-25: `extractPromptText(parts)`

#### Bug 2: Wrong property name for text parts (line 101)
```typescript
// CURRENT CODE
if (part.type === "text" && part.content) {  // WRONG!

// CORRECT (from session-recovery/types.ts and background-agent/manager.ts)
if (part.type === "text" && part.text) {  // Should use 'text'
```

**Evidence**:
- `session-recovery/types.ts`: `interface StoredTextPart { type: "text"; text: string }`
- `background-agent/manager.ts` line 507-508: `if (part.type === "text" && part.text)`

### Recommended Fix
```typescript
function serializeToTranscript(messages: SessionMessage[]): TranscriptEntry[] {
  const entries: TranscriptEntry[] = []
  const timestamp = () => new Date().toISOString()

  for (const msg of messages) {
    const role = msg.info?.role

    // USER MESSAGE HANDLING - FIXED
    if (role === "user") {
      // Handle info.content (existing logic)
      if (msg.info?.content) {
        const content = typeof msg.info.content === "string"
          ? msg.info.content
          : JSON.stringify(msg.info.content)
        entries.push({
          type: "user",
          timestamp: timestamp(),
          content: redactSecrets(content).redacted,
        })
      }
      
      // NEW: Handle user message parts
      for (const part of msg.parts || []) {
        if (part.type === "text" && (part.text || part.content)) {
          entries.push({
            type: "user",
            timestamp: timestamp(),
            content: redactSecrets(part.text || part.content || "").redacted,
          })
        }
      }
    }

    if (role === "assistant") {
      // ... existing assistant handling ...
      
      for (const part of msg.parts || []) {
        // ... tool handling ...
        
        // FIXED: Check both text and content properties
        if (part.type === "text" && (part.text || part.content)) {
          entries.push({
            type: "assistant",
            timestamp: timestamp(),
            content: redactSecrets(part.text || part.content || "").redacted,
          })
        }
      }
    }
  }
  return entries
}
```

### Also Update Types
```typescript
// src/tools/extract-learnings/tools.ts line 12-21
interface MessagePart {
  type: string
  tool?: string
  text?: string      // ADD: for text parts (OpenCode API uses this)
  content?: string   // KEEP: for backward compatibility
  state?: {
    status?: string
    input?: Record<string, unknown>
    output?: unknown
  }
}
```

---

## Issue 2: Context-Learner Agent Prompt Improvements

### Current Gaps
The agent prompt (`src/agents/context-learner.ts`) lacks:

| Gap | Impact | Priority |
|-----|--------|----------|
| No transcript validation step | Analyzes incomplete data without warning | **HIGH** |
| No uncertainty expression instruction | States inferences as facts | **HIGH** |
| No confidence calibration guide | Arbitrary 0-1 scores | **MEDIUM** |
| No failure recovery table | No guidance when data is poor | **MEDIUM** |
| Flat prompt structure | Less clear than XML-structured agents | **LOW** |

### Recommended Prompt Additions

#### 1. Add Pre-Analysis Validation Section (Insert after line 26)
```markdown
## Pre-Analysis Validation (MANDATORY)

Before extracting learnings, verify transcript quality:

1. **Check message type diversity**:
   - User messages present? If NO → Flag: "User prompts not captured"
   - Assistant messages present? If NO → Analysis unreliable
   - Tool results present? If NO → Cannot verify tool outcomes

2. **Set Data Quality Flag**:
   - All types present → "Data Quality: HIGH"
   - Missing user messages → "Data Quality: LOW" + reduce all confidence by 0.2
   - Only tool calls → "Data Quality: INSUFFICIENT" + abort extraction

3. **Add to metadata**:
   \`\`\`markdown
   ## Metadata
   - **Data Quality**: {HIGH|LOW|INSUFFICIENT}
   - **Message Types Found**: {user: N, assistant: N, tool_use: N, tool_result: N}
   \`\`\`

If Data Quality is INSUFFICIENT, write:
\`\`\`markdown
# Meta-Learning Candidates: {session_id}

## Result
Extraction aborted - insufficient data quality.
Reason: Transcript missing {missing types}. Cannot reliably infer patterns.
\`\`\`
```

#### 2. Add Uncertainty Handling Section (Insert after validation section)
```markdown
## Handling Uncertainty

When evidence is ambiguous or incomplete:

1. **STATE YOUR UNCERTAINTY EXPLICITLY**:
   - "User intent could not be verified from transcript"
   - "This pattern may be coincidental rather than systemic"
   - "Evidence is suggestive but not conclusive"

2. **Use hedging language**:
   - "Appears to" instead of "does"
   - "May indicate" instead of "shows"
   - "Suggests" instead of "proves"

3. **Adjust confidence scores**:
   - Missing user messages → reduce confidence by 0.2
   - Single occurrence → max confidence 0.7
   - Contradicting evidence → max confidence 0.5
```

#### 3. Add Confidence Calibration Guide (Replace lines 82-87)
```markdown
## Quality Rules

- **Max 3 candidates** per extraction
- **Min 0.5 confidence** — skip low-confidence
- **Evidence required** — cite transcript lines or excerpts
- **Be specific** — "Use LSP for symbol lookup" not "be smarter"
- **Focus on meta** — improvements to OmO itself, not project-specific

### Confidence Scoring Guide

| Score | Criteria |
|-------|----------|
| 0.9-1.0 | 3+ clear examples, pattern unambiguous, user intent verified |
| 0.8-0.9 | 2 clear examples with supporting context |
| 0.7-0.8 | 1 clear example + corroborating evidence |
| 0.5-0.7 | Pattern suggested but not definitively confirmed |
| <0.5 | Do not extract - insufficient evidence |

### Automatic Confidence Reductions
- Missing user messages: -0.2
- Single-source evidence: -0.1
- Truncated tool outputs: -0.1
- No timestamp correlation: -0.1
```

#### 4. Add Failure Recovery Table (Insert before "Execute the analysis")
```markdown
## Failure Recovery

| Failure | Recovery Action |
|---------|-----------------|
| Transcript too short (<20 entries) | Note: "Session too short for reliable patterns" |
| No user messages | Set "Data Quality: LOW", reduce all confidence by 0.2 |
| Contradicting evidence | Document both interpretations, lower confidence to 0.5 |
| All tool calls failed | Focus on "what went wrong" patterns only |
| Session appears to be testing | Report: "Session was testing/verification only" |
| Uncertain about pattern | **STATE YOUR UNCERTAINTY**, propose as hypothesis |
```

---

## Issue 3: Evidence from Incorrect Analysis

The file `context/learnings/lif74-workflow-control_2025-12-28.md` demonstrates:

### What Went Wrong
1. **Initial claim**: "AI autonomously continued through stages without user approval"
2. **Reality**: User had invoked `/specify`, `/plan`, `/tasks` - the transcript just didn't capture these prompts
3. **Self-correction**: Document acknowledges error at line 9-11

### Why It Happened
1. Transcript only had `tool_use` and `tool_result` entries
2. No `user` type entries (prompts weren't captured)
3. Agent assumed absence of user prompts = no user prompts were given
4. **Logical fallacy**: Absence of evidence ≠ evidence of absence

### Lessons for Prompt
The agent prompt should explicitly warn against this fallacy:
```markdown
## Anti-Patterns to Avoid

1. **Never assume absence of evidence = evidence of absence**
   - Missing user messages may mean capture failure, not user inaction
   - Always check: "Is this transcript complete?" before inferring intent

2. **Never attribute actions without seeing explicit prompts**
   - If you cannot see user prompts, you cannot claim "AI acted autonomously"
   - Correct phrasing: "Based on available tool calls (user prompts not captured)..."
```

---

## Summary of Recommended Changes

### Code Changes (DO NOT IMPLEMENT - Analysis Only)

| File | Change | Priority |
|------|--------|----------|
| `src/tools/extract-learnings/tools.ts` | Add user message parts handling | HIGH |
| `src/tools/extract-learnings/tools.ts` | Fix `part.content` → `part.text \|\| part.content` | HIGH |
| `src/tools/extract-learnings/tools.ts` | Update `MessagePart` interface to include `text?: string` | HIGH |

### Prompt Changes (DO NOT IMPLEMENT - Analysis Only)

| Section | Change | Priority |
|---------|--------|----------|
| New: Pre-Analysis Validation | Check message type diversity before analyzing | HIGH |
| New: Handling Uncertainty | Explicit uncertainty expression instructions | HIGH |
| Updated: Quality Rules | Add confidence calibration guide | MEDIUM |
| New: Failure Recovery | Table of failure scenarios and responses | MEDIUM |
| New: Anti-Patterns | Warn against logical fallacies | MEDIUM |

---

## Cross-Reference: Consensus Findings

All 8 exploration agents agree on:

1. **Transcript capture is incomplete** - User message parts are ignored
2. **Property name mismatch** - `content` vs `text` for text parts
3. **Agent lacks data quality validation** - No pre-analysis checks
4. **Agent lacks uncertainty handling** - No explicit instructions
5. **Librarian agent pattern is best practice** - "STATE YOUR UNCERTAINTY"
6. **Confidence scores need calibration** - Add rubric

No contradictions found between agent findings.

---

## Additional Research Findings (Phase 2)

### Industry Best Practices for Transcript Analysis

From librarian research across LangChain, Anthropic SDK, Great Expectations, and mem0:

#### 1. Data Quality Validation Patterns

| Pattern | Source | Application to Context-Learner |
|---------|--------|-------------------------------|
| `failureRate` tracking | claude-mem, n8n | Add parse error tracking to transcript reader |
| `mostly` thresholds | Great Expectations | "Pass if 95% of expected fields present" |
| ADRI 5-dimension check | adri-standard | Validate: Validity, Completeness, Consistency, Accuracy, Timeliness |

**Recommendation**: Add to transcript serialization:
```typescript
interface TranscriptStats {
  totalMessages: number;
  messagesByType: Record<string, number>;
  failedParses: number;
  failureRate: number;  // failedParses / totalMessages
  qualityScore: "HIGH" | "LOW" | "INSUFFICIENT";
}
```

#### 2. Tool Use/Result Pairing Validation

**Evidence** (MCP SDK): tool_result MUST reference valid tool_use_id, must follow matching tool_use.

**Current gap**: `serializeToTranscript` doesn't validate pairing - could log orphaned tool_results.

#### 3. Content Block Preservation

**Common pitfall**: Flattening content blocks loses tool_use information.

**Current code does this well** - captures tool_use and tool_result as separate entries.

#### 4. Uncertainty Quantification Patterns

| Pattern | Source | Description |
|---------|--------|-------------|
| `confidence_score` | Azure Text Analytics | 0-1 score, >0.9 = high certainty |
| `uncertainty_score` | lm-polygraph | Wraps LLM output with uncertainty estimate |
| `mostly` parameter | Great Expectations | Allow N% failures before flagging |

**Recommendation for context-learner**:
```markdown
## Confidence Modifiers

| Condition | Modifier |
|-----------|----------|
| Missing user messages | -0.2 |
| Single evidence source | -0.1 |
| Transcript < 50 entries | -0.1 |
| Contradicting evidence | -0.3 |
| 3+ corroborating examples | +0.1 |
```

#### 5. JSONL Best Practices

From industry research:
- One JSON object per line (streaming-friendly)
- Always include `timestamp` (ISO8601 with timezone)
- Normalize content to array format (even single text)
- Accumulate streaming chunks before writing
- Include metadata (tokens, cost, model) when available

**Current implementation is good** but missing metadata fields.

---

## Cross-Reference: Consensus vs Contradictions

### Strong Consensus (All Sources Agree)

1. **Data quality validation is mandatory** - All systems check completeness before analysis
2. **Confidence scores need calibration** - Not just 0-1, but rubrics for what each level means
3. **Evidence requirement** - Claims must be grounded in specific data points
4. **Uncertainty expression** - Explicit acknowledgment when data is incomplete
5. **Rate limiting prevents noise** - Max candidates, cooldowns, budgets

### Notable Contradiction

| Topic | Academic Pattern | Production Pattern |
|-------|------------------|-------------------|
| Confidence thresholds | Auto-approve at 0.9+ | Always human review |
| Error handling | Abort on quality issues | Degrade gracefully with warnings |

**Recommendation**: Follow production pattern - degrade gracefully with explicit warnings rather than aborting.

---

## Next Steps (Recommendations)

1. **Create a spec folder** for this improvement work
2. **Prioritize transcript capture fix** - Without complete data, agent improvements are less effective
3. **Update context-learner prompt** with validation and uncertainty sections
4. **Add integration test** that verifies user messages are captured in transcripts
5. **Consider adding "Data Quality" field** to all learning outputs
6. **Add TranscriptStats** to extract-learnings tool output for quality tracking
7. **Validate tool_use/tool_result pairing** in transcript serialization
