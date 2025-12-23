# Self-Improving Chat Review System

**Linear Issue**: [LIF-73](https://linear.app/lifelogger/issue/LIF-73/self-improving-chat-review-system-chat-auditor-agent-context-threshold)
**Created**: 2025-12-23
**Status**: Ready for Planning

## Overview

A self-improving system that analyzes chat conversations to identify quality patterns, improvement opportunities, and actionable feedback. The system creates a continuous feedback loop where oh-my-opencode learns from its own interactions and systematically improves through automated reviews, pattern detection, and Linear issue creation for high-priority improvements.

## Problem Statement

### Current State

Oh-my-opencode is a sophisticated OpenCode plugin with 13 agents, 21 hooks, LSP/AST-grep tools, and MCP integrations. However, there is no mechanism to:

- Measure conversation quality after sessions complete
- Identify when agents use suboptimal workflows (direct tool calls instead of delegation)
- Detect recurring anti-patterns that could be prevented with new hooks or rules
- Distinguish one-off issues from systemic problems requiring code changes
- Create actionable tasks from quality insights

### Issues

1. **No visibility into agent performance**: Developers cannot assess how well agents completed tasks or where improvements are needed
2. **Lost learning opportunities**: Insights gained during complex conversations are not captured or shared across sessions
3. **Manual pattern detection**: Recurring issues require human observation to identify and document
4. **Reactive improvement model**: System improvements happen reactively when users notice problems, not proactively from data
5. **Context loss on compaction**: When context windows fill up, valuable conversation history is summarized or discarded without analysis
6. **No feedback loop**: There's no systematic way to close the improvement loop from observation → analysis → action → verification

## User Stories

### US-1: Automatic Review on Context Threshold

**As a** power user running complex multi-agent workflows,  
**I want** conversations to be reviewed automatically when context usage approaches limits,  
**So that** quality insights are captured before context compaction loses conversation history.

**Acceptance Criteria:**
```gherkin
Given a chat session with context usage above the configured threshold (default 60%)
When the session becomes idle
Then a background review agent spawns without blocking the main conversation
And the agent analyzes the full conversation history against the 6-point quality framework
And a structured review is saved to {reviews_path}/{session_id}.md
And the main conversation continues uninterrupted
```

**Business Value**: Prevents loss of quality insights when conversations grow large. Captures learning opportunities before context gets compacted.

---

### US-2: Manual Review Trigger

**As a** developer who just completed an interesting or problematic conversation,  
**I want** to manually trigger a chat review at any time,  
**So that** I can analyze specific conversations on demand for learning or debugging.

**Acceptance Criteria:**
```gherkin
Given an active or completed chat session
When I invoke /review-chat [optional: session-id]
Then the conversation is analyzed using the 6-point framework
And a structured review is generated and saved
And I receive a summary showing:
  - Overall quality score (1-10)
  - Count of HIGH/MEDIUM/LOW priority improvements
  - Top 3 actionable recommendations
```

**Business Value**: Enables targeted learning from specific conversations. Useful for debugging why a particular task went poorly or understanding an exemplary workflow.

---

### US-3: Review Deduplication and History Tracking

**As a** developer reviewing the same session multiple times,  
**I want** reviews to update the existing file rather than create duplicates,  
**So that** I have a single comprehensive review per session with historical context.

**Acceptance Criteria:**
```gherkin
Given a session that has been reviewed before
When a new review is triggered (manual or automatic)
Then the existing review file is read
And new findings are merged with previous findings (deduplicated by fingerprint)
And the Review History section is appended with:
  - Review timestamp
  - Trigger source (manual/threshold/scheduled)
  - New findings count
  - Key insights summary
And the quality score and executive summary are updated to reflect latest state
```

**Business Value**: Tracks how conversation quality evolves over time. Prevents duplicate findings. Shows if re-reviews after user fixes discover new issues.

---

### US-4: Configurable Review Storage

**As a** developer with project-specific organization preferences,  
**I want** to configure where reviews are stored and how the system behaves,  
**So that** reviews integrate cleanly with my project structure and workflow.

**Acceptance Criteria:**
```gherkin
Given configuration options in oh-my-opencode.json:
  - chat_review.enabled (default: true)
  - chat_review.trigger_on_threshold (default: true)
  - chat_review.threshold_percent (default: 60)
  - chat_review.min_messages (default: 5)
  - chat_review.reviews_path (default: ".opencode/reviews/")
When a review is triggered
Then the system respects these settings
And reviews are saved to the configured path
And the directory is created with recursive: true if it doesn't exist
And environment variable expansion is supported: ${OPENCODE_REVIEWS_PATH}
```

**Business Value**: Flexibility for different project structures. Allows teams to standardize review locations across projects.

---

### US-5: Batch Review Processing Pipeline

**As a** maintainer accumulating review data over time,  
**I want** to batch process reviews to identify patterns and create actionable tasks,  
**So that** systemic improvements are prioritized and tracked in Linear.

**Acceptance Criteria:**
```gherkin
Given multiple unprocessed review files in {reviews_path}/*.md
When I invoke /process-reviews
Then the system:
  - Scans all review files not marked as processed
  - Creates Linear issues for all HIGH priority improvements (one issue per improvement)
  - Aggregates improvement categories across all reviews
  - Detects patterns: if same improvement category appears in 3+ reviews, flag for automation
  - Updates each processed review file with:
    - processed_at: timestamp
    - linear_issue_id: for each created issue
    - status: processed
And returns summary:
  - Total reviews processed: N
  - Linear issues created: M
  - Patterns detected: [list of category + count]
```

**Business Value**: Converts raw review data into actionable work items. Surfaces systemic issues that require architectural changes (new hooks, rules, tools).

---

### US-6: System-Aware Analysis with Dynamic Research

**As a** developer receiving review recommendations,  
**I want** recommendations to be specific to oh-my-opencode's architecture,  
**So that** I can implement suggested improvements without extensive research.

**Acceptance Criteria:**
```gherkin
Given the chat-auditor agent analyzing a conversation
When an improvement opportunity is identified
Then the recommendation includes:
  - Specific file paths (e.g., "Add hook in src/hooks/auto-diagnostics/")
  - Correct improvement category (Hook/Prompt/Rule/Tool/Workflow/Docs)
  - Code examples or patterns from existing implementations
  - Estimated effort (Quick/Short/Medium/Large)
And the agent can dynamically research the codebase using background tasks:
  - background_task(agent="explore", prompt="Find hook patterns for X")
  - background_task(agent="librarian", prompt="Look up OpenCode event system docs")
```

**Business Value**: Actionable recommendations that developers can implement immediately. Reduces research overhead. Ensures recommendations fit existing architecture patterns.

---

### US-7: Privacy and Security Controls

**As a** developer working on sensitive codebases,  
**I want** control over what conversation data is stored and how,  
**So that** I don't accidentally persist secrets or sensitive information.

**Acceptance Criteria:**
```gherkin
Given configuration options:
  - chat_review.redact_secrets (default: true)
  - chat_review.max_excerpt_length (default: 200)
  - chat_review.store_full_transcript (default: false)
When a review is generated
Then:
  - If redact_secrets=true, common secret patterns are masked ([REDACTED])
  - Code excerpts in review are limited to max_excerpt_length characters
  - Full conversation transcript is NOT stored unless store_full_transcript=true
  - Only summary + key excerpts + findings are persisted
And reviews are stored locally by default (no external transmission)
```

**Business Value**: Prevents accidental secret leakage. Reduces storage footprint. Complies with security policies.

---

### US-8: Performance Monitoring and Cost Control

**As a** cost-conscious developer using LLM-based review,  
**I want** visibility into review costs and control over trigger frequency,  
**So that** I can balance insight quality with budget constraints.

**Acceptance Criteria:**
```gherkin
Given configuration options:
  - chat_review.cooldown_minutes (default: 30)
  - chat_review.max_reviews_per_session (default: 3)
  - chat_review.max_daily_reviews (default: 20)
When automatic triggers fire
Then:
  - Cooldown is enforced: same session won't trigger within cooldown_minutes
  - Per-session limit enforced: max_reviews_per_session applies
  - Daily budget enforced: max_daily_reviews applies globally
And review metadata includes:
  - input_tokens: approximate token count for analysis
  - model_cost: estimated cost in USD
And /process-reviews shows aggregate cost metrics
```

**Business Value**: Prevents runaway costs from aggressive auto-triggering. Provides cost visibility for budget planning.

---

## Requirements

### Functional Requirements

#### FR-1: Chat Auditor Agent
- **Purpose**: Specialist agent that analyzes conversations and writes review files
- **Model**: Gemini 2.5 Flash (1M context, $0.30/M input, $2.50/M output, fast latency)
- **Role**: Specialist (can write files, subject to governance)
- **Capabilities**:
  - Analyzes conversations using 6-point quality framework
  - Deep knowledge of oh-my-opencode architecture injected via prompt
  - Can spawn background research agents (explore, librarian) for accurate recommendations
  - Writes structured markdown reviews to disk
  - Updates existing reviews instead of creating duplicates
- **Input**: Serialized conversation history + metadata (session_id, context_pct, model, trigger)
- **Output**: Structured review file with scores, findings, recommendations

#### FR-2: Context-Threshold Review Hook
- **Purpose**: Automatically triggers review when context usage is high
- **Trigger Conditions**:
  - Session.idle event fires
  - Context usage ≥ threshold_percent (default 60%)
  - Message count ≥ min_messages (default 5)
  - Not currently in cooldown period
- **Behavior**:
  - Debounces triggers (wait 200ms to confirm idle, like todo-continuation-enforcer)
  - Checks if review already in-flight for this session (dedupe)
  - Computes context usage from `ctx.client.session.messages()` token metadata
  - Falls back to heuristic (message length) if token metadata unavailable
  - Spawns background agent with serialized chat + metadata
  - Non-blocking: main conversation continues immediately
- **State Management**:
  - Per-session: `inFlight: boolean`, `lastReviewedHash: string`, `lastReviewTime: timestamp`
  - Uses hash of message IDs to detect if conversation changed since last review

#### FR-3: Manual Review Command
- **Command**: `/review-chat [session-id]`
- **Behavior**:
  - If session-id omitted, uses current session
  - Delegates to chat-auditor agent (synchronous execution)
  - Waits for review completion
  - Returns summary to user:
    - Quality score
    - HIGH/MEDIUM/LOW improvement counts
    - Top 3 recommendations
- **Options**: 
  - `--fast`: Summary + last N turns only (faster, cheaper)
  - `--deep`: Full transcript analysis (default)

#### FR-4: Review Storage System
- **Location**: Configurable via `chat_review.reviews_path` (default: `.opencode/reviews/`)
- **Filename**: `{session_id}.md` (one file per session)
- **Format**: Structured markdown with:
  - YAML-like metadata section (session_id, timestamps, model, context_pct)
  - Quality score (1-10)
  - Executive summary (2-3 sentences)
  - Actionable improvements table (HIGH/MEDIUM/LOW priority)
  - Review history section (append-only log of each review pass)
- **Write Strategy**:
  - Atomic write: write to temp file, then rename
  - Update mode: read existing → merge findings → rewrite
  - Deduplication: fingerprint each finding by (category + issue description hash)

#### FR-5: Batch Processing Pipeline
- **Command**: `/process-reviews [options]`
- **Options**:
  - `--unprocessed-only`: Only process reviews without `processed_at` timestamp (default)
  - `--all`: Reprocess all reviews
  - `--priority <HIGH|MEDIUM|LOW>`: Filter by improvement priority
- **Processing Steps**:
  1. Scan review files matching criteria
  2. Extract HIGH priority improvements
  3. Check Linear for existing issues (dedupe by review key: `session_id + improvement hash`)
  4. Create Linear issues with:
     - Title: `[Review] {improvement description}`
     - Description: Context + suggested fix + file references
     - Label: `review-feedback`, improvement category
     - Priority: Map HIGH→Urgent, MEDIUM→High, LOW→Normal
  5. Aggregate patterns: count improvement categories across reviews
  6. Flag patterns appearing in 3+ reviews for automation consideration
  7. Update review files with `processed_at` and `linear_issue_id`
  8. Return summary report

#### FR-6: Configuration Schema
- **New Config Section**: `chat_review`
- **Options**:
  ```typescript
  {
    enabled: boolean;              // Default: true
    trigger_on_threshold: boolean; // Default: true
    threshold_percent: number;     // Default: 60 (range: 0-100)
    min_messages: number;          // Default: 5
    reviews_path: string;          // Default: ".opencode/reviews/"
    redact_secrets: boolean;       // Default: true
    max_excerpt_length: number;    // Default: 200
    store_full_transcript: boolean;// Default: false
    cooldown_minutes: number;      // Default: 30
    max_reviews_per_session: number;// Default: 3
    max_daily_reviews: number;     // Default: 20
  }
  ```

### Non-Functional Requirements

#### NFR-1: Non-Blocking Operation
- **Requirement**: Review operations must not block main conversation
- **Targets**:
  - Auto-trigger dispatch: <100ms overhead on session.idle
  - Background agent spawn: <500ms
  - Manual /review-chat: User sees immediate "Review started..." feedback
- **Implementation**: All analysis runs in background child sessions (BackgroundManager pattern)

#### NFR-2: Context Efficiency
- **Requirement**: Efficient handling of large conversation histories
- **Constraints**:
  - Background agents don't inherit context (must serialize into prompt)
  - Gemini 2.5 Flash has 1M token context window
- **Targets**:
  - Typical session (10KB markdown): ~2.5k tokens input, ~1k tokens output = $0.0037 per review
  - Large session (50KB markdown): ~15k tokens input, ~3k tokens output = $0.0158 per review
  - Maximum input: 100k tokens (reserve capacity for instructions + output)
- **Implementation**:
  - Default mode: summary + last N turns + key excerpts (not full transcript)
  - Deep mode (opt-in): full transcript for comprehensive analysis
  - Adaptive truncation when approaching limits

#### NFR-3: Reliability
- **Requirement**: Reviews persist even if session terminates unexpectedly
- **Measures**:
  - Atomic file writes (write to temp, rename)
  - Job state machine: queued → running → succeeded/failed/canceled
  - Lock files with expiry (prevent duplicate processing)
  - Retry logic with exponential backoff for transient failures
  - Graceful degradation if Linear MCP unavailable (reviews still saved locally)
- **Recovery**: On startup, sweep detects abandoned jobs (status=running, age>threshold) and marks them failed

#### NFR-4: Privacy and Security
- **Requirement**: Prevent accidental secret persistence
- **Measures**:
  - Secret detection patterns: API keys, tokens, passwords, private keys
  - Redaction: Replace detected secrets with `[REDACTED: {type}]`
  - Excerpt limits: Max 200 chars per code sample (configurable)
  - Local storage only by default
  - No external transmission without explicit configuration
  - Review files stored in `.opencode/reviews/` (git-ignored by default)

#### NFR-5: Cost Control
- **Requirement**: Predictable and controllable review costs
- **Measures**:
  - Per-session cooldown: prevents rapid re-triggers
  - Daily budget cap: configurable max reviews per day
  - Token metering: log input/output tokens + cost per review
  - Summary mode by default (cheaper than deep mode)
- **Monitoring**: `/process-reviews --stats` shows aggregate cost data

#### NFR-6: Scalability
- **Requirement**: Handle high-volume usage gracefully
- **Targets**:
  - Support 1000+ review files without performance degradation
  - Batch processing handles 100+ reviews in single run
  - Concurrent background reviews (different sessions) supported
- **Measures**:
  - Incremental processing (only new/changed reviews)
  - Index/metadata for fast filtering
  - Concurrency limits (max 2-5 concurrent Linear API calls)
  - Rate limiting respect (honor Linear API throttles)

---

## Analysis Framework

The chat-auditor evaluates conversations across **6 quality dimensions**:

| Dimension | Measures | Scoring Criteria |
|-----------|----------|------------------|
| **Task Completion** | Did the conversation achieve its primary goal? | **10**: Goal fully achieved in <3 iterations<br>**7**: Goal achieved with minor detours<br>**4**: Partial progress, unresolved issues<br>**1**: No meaningful progress |
| **Agent Utilization** | Were appropriate specialist agents delegated to? | **10**: Optimal delegation (background tasks for research, specialists for implementation)<br>**7**: Some delegation, missed opportunities<br>**4**: Mostly direct tool calls, no delegation<br>**1**: Anti-patterns (main agent doing specialist work) |
| **Tool Efficiency** | Were tools used effectively (LSP, AST-grep, etc.)? | **10**: LSP for navigation, AST-grep for complex patterns, minimal redundant searches<br>**7**: Some LSP usage, occasional redundancy<br>**4**: Grep-heavy, no LSP, many redundant searches<br>**1**: Blind file reads, massive tool output ignored |
| **Workflow Adherence** | Was the /specify→/plan→/tasks→/implement workflow followed? | **10**: Proper workflow, spec-driven development<br>**7**: Partial workflow, some shortcuts<br>**4**: Ad-hoc approach, no specs<br>**1**: Chaotic, no structure |
| **Error Handling** | Were errors handled well? Proactive diagnostics? | **10**: lsp_diagnostics before commits, graceful recovery, minimal error loops<br>**7**: Reactive diagnostics, some error loops<br>**4**: Manual error discovery, delayed fixes<br>**1**: Errors ignored or repeatedly failed |
| **Context Management** | Was context window managed efficiently? | **10**: Aggressive background delegation, minimal context bloat<br>**7**: Some background tasks, moderate efficiency<br>**4**: Large inline outputs, poor delegation<br>**1**: Context overflow, massive tool dumps |

**Overall Quality Score**: Weighted average (all dimensions equal weight), rounded to integer 1-10.

---

## Improvement Categories

Reviews classify findings into **6 actionable categories**:

| Category | What It Fixes | Example Issue | Suggested Action | Implementation Path |
|----------|---------------|---------------|------------------|---------------------|
| **A: Hook** | Repeated manual operations that should be automated | "Agent always forgets to run lsp_diagnostics after editing files" | Create `auto-diagnostics` hook triggered on PostToolUse(Edit) | Create `src/hooks/auto-diagnostics/index.ts`, add to builtinHooks |
| **B: Prompt** | Agent behavior misaligned with intended role | "OmO directly edits frontend code instead of delegating to frontend-ui-ux-engineer" | Update OmO agent prompt to emphasize delegation for frontend work | Edit `src/agents/omo.ts` prompt section |
| **C: Rule** | Missing domain knowledge in instruction files | "Agent doesn't know project's authentication pattern" | Add rule to `.opencode/instructions/auth-patterns.md` | Create instruction file in project |
| **D: Tool** | Tool output too verbose or missing functionality | "Grep returns 50k tokens of output, blows context" | Enhance grep-output-truncator with adaptive limits | Edit `src/hooks/grep-output-truncator/index.ts` |
| **E: Workflow** | Missing command for common operation | "No way to resume implementation from existing tasks.md" | Create `/resume-implementation` command | Add command to `.opencode/command/resume-implementation.md` |
| **F: Docs** | Missing knowledge in AGENTS.md or README | "Agent doesn't know about Mintlify deployment process" | Update project AGENTS.md with deployment section | Edit AGENTS.md in project root |

**Priority Assignment**:
- **HIGH**: Impacts correctness, security, or causes frequent failures
- **MEDIUM**: Impacts efficiency or developer experience significantly
- **LOW**: Minor improvements, nice-to-haves

---

## Review File Structure

```markdown
# Chat Review: {session_id}

## Metadata
- **Session ID**: {session_id}
- **Model**: {model_name}
- **Context Usage**: {percentage}% ({used_tokens}/{limit_tokens})
- **Message Count**: {count}
- **First Reviewed**: {iso8601_timestamp}
- **Last Updated**: {iso8601_timestamp}
- **Review Count**: {n}
- **Status**: draft | processed
- **Processed At**: {iso8601_timestamp} (if processed)

## Quality Score: {score}/10

## Executive Summary
{2-3 sentence summary of conversation topic, outcome, and key quality findings}

## Dimension Scores
| Dimension | Score | Notes |
|-----------|-------|-------|
| Task Completion | {1-10} | {brief justification} |
| Agent Utilization | {1-10} | {brief justification} |
| Tool Efficiency | {1-10} | {brief justification} |
| Workflow Adherence | {1-10} | {brief justification} |
| Error Handling | {1-10} | {brief justification} |
| Context Management | {1-10} | {brief justification} |

## Actionable Improvements

### HIGH Priority
| ID | Category | Issue | Suggested Fix | Effort | Linear Issue |
|----|----------|-------|---------------|--------|--------------|
| H1 | Hook | Agent forgets lsp_diagnostics | Create auto-diagnostics hook | Short | [LIF-123](#) |
| H2 | Prompt | OmO edits directly instead of delegating | Update delegation rules in prompt | Quick | - |

### MEDIUM Priority
| ID | Category | Issue | Suggested Fix | Effort | Linear Issue |
|----|----------|-------|---------------|--------|--------------|
| M1 | Tool | Grep output too large | Enhance truncator with adaptive limits | Medium | - |

### LOW Priority
| ID | Category | Issue | Suggested Fix | Effort | Linear Issue |
|----|----------|-------|---------------|--------|--------------|
| L1 | Docs | Missing deploy process | Add section to AGENTS.md | Quick | - |

## Key Excerpts
### Example of Anti-pattern (Tool Efficiency)
```
User: Find all TypeScript files with 'export class'
Agent: <uses grep, returns 45k tokens of output>
Agent: <context overflow, conversation restarted>
```
**Better Approach**: Use `ast_grep_search(pattern="export class $NAME", lang="typescript")` for structured results.

### Example of Good Pattern (Agent Utilization)
```
Agent: Delegating to @explore to find authentication patterns
Agent: Delegating to @librarian to look up Linear API docs
Agent: <processes both results in parallel, continues implementation>
```

## Review History

### Review #1 - 2025-12-23T10:30:00Z
- **Trigger**: threshold (65% context usage)
- **New Findings**: 5 (2 HIGH, 2 MEDIUM, 1 LOW)
- **Key Insight**: Heavy grep usage without AST-grep, context management poor

### Review #2 - 2025-12-23T14:15:00Z
- **Trigger**: manual
- **New Findings**: 1 (1 MEDIUM)
- **Key Insight**: User applied H1 fix, context management improved, discovered new tool efficiency issue

---

## Metadata (not visible in file, used internally)
- **Fingerprints**: {hash_map of finding_id → content_hash for deduplication}
- **Cost**: {input_tokens: N, output_tokens: M, estimated_usd: X}
```

---

## Technical Constraints

### 1. No Pre-Compaction Event
**Constraint**: OpenCode fires `session.compacted` **after** compaction, not before. Cannot hook pre-compaction directly.

**Workaround**: Use context threshold + session.idle to approximate pre-compaction trigger. When context >60% and session goes idle, high probability compaction is imminent.

**Implication**: Reviews may occasionally fire after compaction already happened. Accept as limitation; users can always trigger manually.

---

### 2. Background Tasks Don't Inherit Context
**Constraint**: Background agents receive only the prompt text. No access to parent session context.

**Workaround**: Serialize full conversation history into the background agent's prompt. Use structured format:

```markdown
TASK: Analyze this conversation for quality

CONVERSATION HISTORY (serialized):
[Message 1 - User]: {content}
[Message 2 - Assistant]: {content}
...

METADATA:
- Session ID: {id}
- Context Usage: {pct}
- Model: {model}
```

**Implication**: Prompt can get large for long conversations. Use summary mode by default; deep mode opt-in.

---

### 3. Agent Role for File Writing
**Constraint**: Only specialist agents can write files (subject to governance).

**Design Decision**: Chat-auditor must be specialist role, not utility/advisor.

**Implication**: Chat-auditor subject to governance-path-validator. Must ensure `.opencode/reviews/` is in allowed paths.

---

### 4. Context Usage Measurement Unreliable Across Providers
**Constraint**: Token metadata format differs across providers (Anthropic, OpenAI, Google). Some may not expose token counts.

**Workaround**: 
- Primary: Use `ctx.client.session.messages()` token metadata when available
- Fallback: Heuristic (message length * 0.25 tokens/char)
- Flag reviews with `context_measurement: estimated` when using fallback

**Implication**: Threshold trigger may be less accurate for non-Anthropic providers. Document limitation.

---

### 5. Governance Path Validator May Block Writes
**Constraint**: Default governance rules may block writes to `.opencode/reviews/` if not in allowed paths.

**Workaround**: Explicitly add `.opencode/reviews/` to `governance.path_validation.allowed_paths` in default config.

**Implication**: Initial setup must configure governance; otherwise reviews will fail silently.

---

## Success Criteria

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| **Review Generation Coverage** | 95% of threshold-exceeded sessions | Count reviews / sessions where context >60% |
| **Non-Blocking Performance** | <100ms impact on session.idle | Performance profiling of hook dispatch |
| **Deduplication Accuracy** | 0 duplicate review files per session | File system audit: `find reviews/ -name "*.md" | sort | uniq -d` |
| **Actionability Rate** | 80% of HIGH priority items are implementable within 1 day | Manual review sampling (N=20 reviews) |
| **Pattern Detection Precision** | Patterns flagged in 3+ reviews represent actual systemic issues | Expert review of aggregated patterns |
| **False Positive Rate** | <10% of improvements marked MEDIUM/LOW upon implementation | Post-implementation review |
| **Cost Efficiency** | Average review cost <$0.01 for typical sessions | Cost tracking: `sum(review_costs) / count(reviews)` |
| **User Satisfaction** | 4.5/5 rating on review usefulness | Survey after 2 weeks of usage |

---

## Assumptions

1. **Context Threshold Approximates Pre-Compaction**: Triggering at 60% context usage will capture most conversations before critical history loss
2. **Gemini 2.5 Flash Quality**: Gemini 2.5 Flash can accurately analyze conversations and provide actionable recommendations (verified by research showing 63.8% SWE-Bench performance)
3. **Linear MCP Availability**: Linear MCP is configured and functional for batch processing (graceful degradation if not)
4. **Session Idle Semantics**: `session.idle` reliably fires when agent stops responding (verified by existing hook usage in todo-continuation-enforcer)
5. **File System Reliability**: Atomic rename operations work correctly on target platforms (macOS, Linux, Windows)
6. **Oh-my-opencode Knowledge Stability**: Agent's baked-in knowledge of oh-my-opencode architecture remains accurate across minor version updates

---

## Dependencies

### Required
- **Background agent system**: For spawning non-blocking review tasks (already exists in oh-my-opencode)
- **Session messages API**: For accessing conversation history (`ctx.client.session.messages()`)
- **File write capability**: Specialist agents must be able to write to `.opencode/reviews/`

### Optional
- **Linear MCP**: For creating issues via `/process-reviews` (graceful degradation if unavailable)
- **LSP tools**: For chat-auditor to research codebase during analysis (enhances recommendation quality)

### External
- **Gemini 2.5 Flash API**: Model availability and pricing stability
- **OpenCode version**: Requires ≥1.0.132 (config bug fixes)

---

## Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Auto-trigger loops**: session.idle fires repeatedly, causing duplicate reviews | Medium | High | Debounce + cooldown + `inFlight` flag per session |
| **Context measurement inaccuracy**: Heuristic-based threshold unreliable for non-Anthropic models | Medium | Medium | Flag reviews with `context_measurement: estimated`, allow manual override |
| **Governance blocks writes**: Path validator prevents review file creation | Low | High | Add `.opencode/reviews/` to default allowed paths, clear error messages |
| **Linear API rate limiting**: Batch processing hits 429 errors | Medium | Medium | Concurrency limit (2-5 parallel), exponential backoff, retry with jitter |
| **Secret leakage in reviews**: Conversation contains API keys that get persisted | Medium | Critical | Redaction patterns for common secrets, excerpt length limits, security audit |
| **Cost runaway**: Aggressive auto-trigger on large sessions | Medium | Medium | Daily budget cap, per-session cooldown, cost monitoring dashboard |
| **Race condition on review update**: Concurrent manual + auto-trigger | Low | Low | File locks with expiry, atomic writes |
| **Background agent timeout**: Long conversations time out during analysis | Low | Medium | Timeout handling, partial review save, retry with summary mode |

---

## Design Decisions

### DD-1: Gemini 2.5 Flash for Chat Auditor
**Decision**: Use Gemini 2.5 Flash instead of Claude or GPT.

**Context**: Need a model for conversation analysis that balances cost, speed, and quality.

**Options Considered**:
1. Claude Sonnet 4.5 (high quality, moderate cost)
2. GPT-4o (high quality, moderate cost)
3. Gemini 2.5 Flash (good quality, very low cost, 1M context)

**Rationale**: 
- Cost: $0.30/M input vs $3/M for Claude/GPT (10x cheaper)
- Context window: 1M tokens handles even very large conversations
- Speed: Optimized for low latency
- Quality: 63.8% SWE-Bench Verified (sufficient for pattern detection)
- Structured output: Native JSON schema support

**Trade-off**: Slightly lower reasoning quality than Claude Opus/GPT-5.2, but acceptable for analysis task. Can always upgrade model later if quality insufficient.

---

### DD-2: Session.Idle + Context Threshold (Not Real-Time)
**Decision**: Trigger reviews on session.idle when context >60%, not in real-time during conversation.

**Context**: Wanted pre-compaction trigger, but no such event exists. Real-time monitoring would add overhead.

**Options Considered**:
1. Real-time monitoring: Hook every message, check context constantly
2. Session.idle + threshold: Wait for idle, then check context usage
3. Manual-only: No auto-trigger, users must invoke /review-chat

**Rationale**:
- Performance: Real-time adds latency to every message
- Accuracy: session.idle is reliable trigger (proven by existing hooks)
- Approximation: 60% threshold catches most conversations before compaction
- Existing pattern: todo-continuation-enforcer uses same approach

**Trade-off**: May occasionally trigger after compaction already happened. Accept as limitation; full manual trigger available.

---

### DD-3: One Review File Per Session (Update-in-Place)
**Decision**: Store reviews as `{session_id}.md`, update existing file on re-review.

**Context**: Need durable storage that tracks review history without duplication.

**Options Considered**:
1. One file per review: `{session_id}_{timestamp}.md` (every review creates new file)
2. One file per session: `{session_id}.md` (update-in-place with history section)
3. Database: SQLite for structured storage

**Rationale**:
- Simplicity: Markdown files are human-readable, git-diffable, easy to backup
- Deduplication: Prevents dozens of files for same session
- History: Review History section tracks evolution over time
- Tooling: No database dependencies, works anywhere

**Trade-off**: Concurrent review risk (mitigated with file locks). Not queryable without parsing (future: add optional SQLite index).

---

### DD-4: Background Agent for All Analysis
**Decision**: Always run chat-auditor in background, even for manual /review-chat.

**Context**: Need to prevent main conversation blocking during analysis.

**Options Considered**:
1. Background for auto-trigger, synchronous for manual
2. Background always
3. Synchronous always

**Rationale**:
- Consistency: Same code path for auto + manual
- Performance: Even manual reviews can analyze large sessions
- User experience: Immediate feedback ("Review started..."), results arrive via notification

**Trade-off**: Manual reviews feel less immediate (mitigated with progress updates). Can add --sync flag if users demand synchronous mode.

---

### DD-5: 6-Point Quality Framework (Not Custom Per Project)
**Decision**: Use fixed 6 dimensions (Task Completion, Agent Utilization, Tool Efficiency, Workflow Adherence, Error Handling, Context Management), not customizable.

**Context**: Need consistent scoring across reviews for pattern detection.

**Options Considered**:
1. Fixed framework: Same 6 dimensions for all projects
2. Configurable framework: Projects define custom dimensions
3. LLM-generated framework: Agent decides dimensions per conversation

**Rationale**:
- Comparability: Fixed dimensions allow aggregation across reviews
- Simplicity: No configuration burden on users
- Completeness: 6 dimensions cover critical quality aspects identified by research (SPHERE, VISTA frameworks)
- Industry alignment: Matches academic best practices

**Trade-off**: May not perfectly fit every project's needs. Can add custom fields in future if demand exists.

---

## Open Questions

1. **Should reviews be git-committed automatically?**
   - **Context**: Reviews stored in `.opencode/reviews/` which is typically git-ignored
   - **Options**: 
     - A) Always local-only (current design)
     - B) Configurable: `chat_review.commit_to_git: boolean`
     - C) Smart: Auto-commit if `.opencode/reviews/` not in `.gitignore`
   - **Recommendation**: Start with A (local-only), add B if teams want to share reviews

2. **What is the retention policy for old reviews?**
   - **Context**: Reviews accumulate over time, potentially 100s of files
   - **Options**:
     - A) Keep forever
     - B) Prune after N days: `chat_review.retention_days: number`
     - C) Archive processed reviews: move to `.opencode/reviews/archive/`
   - **Recommendation**: Start with A (keep forever), add B if storage becomes issue

3. **Should pattern detection create issues automatically or require approval?**
   - **Context**: When 3+ reviews flag same category, /process-reviews can auto-create "systemic issue" Linear issue
   - **Options**:
     - A) Auto-create with label `auto-detected-pattern`
     - B) Dry-run: Show what would be created, require --approve flag
     - C) Interactive: Prompt for confirmation per pattern
   - **Recommendation**: Start with B (dry-run by default), add --auto-create flag for CI/cron

---

## Out of Scope

The following are explicitly **not** included in this feature:

1. **Real-time review during conversation**: Would impact performance; use post-session review instead
2. **Automatic implementation of suggested improvements**: Requires human review; too risky to auto-apply code changes
3. **Cross-project review aggregation**: Each project's reviews are independent; no global pattern detection across repos
4. **Training/fine-tuning based on reviews**: Would require infrastructure for model customization; out of scope
5. **A/B testing of improvements**: No framework for testing "before/after" impact of applied changes
6. **Review of non-chat artifacts**: Only analyzes chat conversations, not code commits, PRs, or documentation directly
7. **Multi-user collaboration on reviews**: Single-user workflow; no review sharing, commenting, or approval processes
8. **Custom scoring algorithms**: Fixed 6-point framework; no pluggable scoring systems
9. **Historical trend analysis**: No dashboards showing quality trends over time (future enhancement)
10. **Integration with external analytics platforms**: Reviews stored locally; no exports to DataDog, Splunk, etc.
