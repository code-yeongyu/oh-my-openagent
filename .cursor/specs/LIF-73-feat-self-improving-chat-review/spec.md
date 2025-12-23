# Self-Improving Session Learning System

**Linear Issue**: [LIF-73](https://linear.app/lifelogger/issue/LIF-73/self-improving-chat-review-system-chat-auditor-agent-context-threshold)
**Created**: 2025-12-23
**Updated**: 2025-12-23 (Revised: Simplified Meta-Learning Focus)
**Status**: Ready for Planning

## Overview

A dual-system self-improving framework that separates project knowledge management from meta-level workflow improvement:

### System 1: Memory Tools (~4h)
Serena-compatible memory management tools (`memory_write`, `memory_read`, `memory_edit`, `memory_list`, `memory_delete`) built into oh-my-opencode. Works standalone without Serena MCP. Configurable storage path (default: `.cursor/memory/`), subdirectory support (`decisions/`), maintains canonical files (`constitution.md`, `architecture.md`, `tech-stack.md`, `glossary.md`).

### System 2: Meta-Learning Extraction (~8h)
Extracts insights specifically for improving **OmO orchestration, delegation, commands, and agent instructions**—not general project learnings. Uses `experimental.session.compacting` hook (fires BEFORE compaction) to capture learnings before context loss. Outputs to `context/learnings/` buffer for human review. Actionable insights become features via `/specify` workflow.

**Key Discovery**: OpenCode's `experimental.session.compacting` hook fires BEFORE compaction, enabling extraction before context is lost. Total effort: ~12h (reduced from 16.5h by removing chat quality framework).

## Problem Statement

### Current State

Oh-my-opencode is a sophisticated OpenCode plugin with 13+ agents, 21+ hooks, LSP/AST-grep tools, and MCP integrations. Project knowledge exists in `.cursor/memory/` (constitution, architecture, tech-stack, glossary) but:

- **No Serena-compatible memory tools**: Requires Serena MCP for memory_write/read/edit operations
- **Fixed Serena path**: Serena uses `.serena/memories/` (non-configurable), conflicts with `.cursor/memory/` convention
- **No subdirectory support**: Serena stores flat files, can't organize as `decisions/ADR-*.md`
- **Meta-learnings lost**: Insights on improving OmO orchestration, delegation, command workflows evaporate
- **Manual improvement cycle**: Must manually identify workflow improvements and create feature specs

### Issues

1. **Tool dependency**: Agents need Serena MCP installed to use memory operations
2. **Path mismatch**: Serena's `.serena/memories/` doesn't align with `.cursor/memory/` convention used by `/update-context`
3. **Organization limits**: Can't maintain subdirectories like `decisions/` for ADRs
4. **Workflow improvement blind spots**: No systematic capture of what works/fails in orchestration patterns
5. **Manual meta-learning**: Developers must remember to document delegation failures, command UX issues, agent instruction gaps

## User Stories

### US-MEMORY-TOOLS: Serena-Compatible Memory Operations

**As an** agent needing persistent project knowledge,  
**I want** memory_write/read/edit/list/delete tools built into oh-my-opencode,  
**So that** I can manage project memory without requiring Serena MCP installation.

**Acceptance Criteria:**
```gherkin
Given oh-my-opencode is installed
When an agent calls memory_write(name="architecture", content="...")
Then the content is written to .cursor/memory/architecture.md
And subdirectories are supported (e.g., "decisions/ADR-001")
And the tools work identically whether Serena MCP is installed or not
```

**Business Value**: Removes Serena MCP dependency. Aligns storage with `/update-context` convention (`.cursor/memory/`). Enables subdirectory organization.

---

### US-META-EXTRACT: Automatic Meta-Learning Extraction

**As a** developer improving oh-my-opencode workflows,  
**I want** the system to automatically extract orchestration improvement insights,  
**So that** I learn what delegation patterns, commands, and agent instructions need fixing.

**Acceptance Criteria:**
```gherkin
Given a development session where OmO delegates work and uses commands
When experimental.session.compacting fires (BEFORE compaction)
Then the system snapshots session context synchronously
And spawns background extraction task (non-blocking)
And outputs meta-learning candidates to context/learnings/{session_id}.md
And candidates focus on: delegation patterns, command UX, agent instructions, orchestration
```

**Business Value**: Captures workflow improvement insights before context is lost. Focuses on meta-level improvements (not general project knowledge).

---

### US-HUMAN-REVIEW: Human Review Workflow

**As a** human reviewer of meta-learning candidates,  
**I want** to read extracted learnings and decide which become features,  
**So that** I control what workflow improvements get implemented.

**Acceptance Criteria:**
```gherkin
Given meta-learning candidates in context/learnings/{session_id}.md
When I review the file manually
Then I see insights categorized by:
  - Agent instructions (prompt improvements)
  - Commands (workflow UX improvements)
  - Orchestration (delegation pattern improvements)
  - Context handling (memory/compaction improvements)
  - Tool usage (LSP/AST-grep efficiency)
And I decide: ignore, note for later, or use /specify to create feature spec
```

**Business Value**: Human gate ensures only actionable improvements become work. Prevents noise and low-quality automation.

---

### US-CONFIG-PATHS: Configurable Memory Paths

**As a** project maintainer with specific organization preferences,  
**I want** to configure where memory files are stored,  
**So that** the system aligns with my project structure.

**Acceptance Criteria:**
```gherkin
Given configuration options in oh-my-opencode.json:
  - memory.root (default: ".cursor/memory/")
  - memory.allowSubdirs (default: true)
  - memory.registerSerenaAliases (default: false)
When an agent calls memory_write("architecture", "content")
Then the file is written to {memory.root}/architecture.md
And subdirectories work: memory_write("decisions/ADR-001", "...")
```

**Business Value**: Flexibility for different project structures. No conflicts with Serena MCP if both are installed (aliases opt-in).

---

### US-EXTRACT-COMMAND: Manual Meta-Learning Extraction

**As a** developer finishing complex work,  
**I want** to manually trigger meta-learning extraction,  
**So that** I can capture insights even if automatic triggers didn't fire.

**Acceptance Criteria:**
```gherkin
Given a completed session with orchestration work
When I invoke /extract-learnings
Then the system analyzes the session for meta-level improvements
And outputs candidates to context/learnings/{session_id}.md
And shows summary: "N candidates extracted, review context/learnings/"
```

**Business Value**: Manual safety net for sessions where automatic extraction didn't trigger or was disabled.
When a learning or improvement opportunity is identified
Then the output includes:
  - Specific file paths (e.g., "Add hook in src/hooks/auto-diagnostics/")
  - Correct category (constitution/architecture/tech-stack/glossary/Hook/Prompt/Rule/Tool/Workflow/Docs)
  - Code examples or patterns from existing implementations
  - Evidence from the session (file excerpts, tool outputs)
  - Estimated effort (Quick/Short/Medium/Large) for improvements
And the agent can dynamically research the codebase using background tasks:
  - background_task(agent="explore", prompt="Find similar patterns for X")
  - background_task(agent="librarian", prompt="Look up OpenCode event system docs")
```

**Business Value**: Actionable recommendations that developers can implement immediately. Reduces research overhead. Ensures recommendations fit existing architecture patterns.

---

### US-PRIVACY: Privacy and Security Controls

**As a** developer working on sensitive codebases,  
**I want** control over what conversation data is stored and how,  
**So that** I don't accidentally persist secrets or sensitive information.

**Acceptance Criteria:**
```gherkin
Given configuration options:
  - context_learning.redact_secrets (default: true)
  - context_learning.max_excerpt_length (default: 200)
When a learning candidate or review is generated
Then:
  - If redact_secrets=true, common secret patterns are masked ([REDACTED])
  - Code excerpts are limited to max_excerpt_length characters
  - Only summary + key excerpts + findings are persisted
  - Full transcripts stored only when explicitly requested (--save-transcript)
And all data is stored locally by default (no external transmission)
```

**Business Value**: Prevents accidental secret leakage. Reduces storage footprint. Complies with security policies.

---

### US-COST-CONTROL: Performance Monitoring and Cost Control

**As a** cost-conscious developer using LLM-based analysis,  
**I want** visibility into costs and control over trigger frequency,  
**So that** I can balance insight quality with budget constraints.

**Acceptance Criteria:**
```gherkin
Given configuration options:
  - context_learning.cooldown_minutes (default: 60)
  - context_learning.max_learnings_per_session (default: 2)
  - context_learning.max_daily_learnings (default: 10)
When automatic triggers fire
Then:
  - Cooldown is enforced: same session won't trigger within cooldown_minutes
  - Per-session limit enforced: max_learnings_per_session applies
  - Daily budget enforced: max_daily_learnings applies globally
And learning candidate metadata includes:
  - input_tokens: approximate token count for analysis
  - model_cost: estimated cost in USD
And /review-learnings shows aggregate cost metrics
```

**Business Value**: Prevents runaway costs from aggressive auto-triggering. Provides cost visibility for budget planning. Gemini 2.5 Flash is cost-efficient ($0.30/M input) so budget impact is minimal.

---

## Requirements

### Functional Requirements

#### FR-1: Memory Tools (Serena-Compatible)
- **Purpose**: Provide memory management without requiring Serena MCP installation
- **Location**: `src/tools/memory/` (follows standard tool structure)
- **Tool Names**:
  | Canonical Name | Serena Alias | Function |
  |----------------|--------------|----------|
  | `omo_write_memory` | `write_memory`* | Write content to memory file |
  | `omo_read_memory` | `read_memory`* | Read content from memory file |
  | `omo_edit_memory` | `edit_memory`* | Edit content via regex/literal replace |
  | `omo_list_memories` | `list_memories`* | List all memory files |
  | `omo_delete_memory` | `delete_memory`* | Delete a memory file |
  
  *Serena aliases only registered if `memory.registerSerenaAliases: true`
  
- **Enhancements over Serena**:
  - Configurable storage path (default: `.cursor/memory/`, aligns with `/update-context`)
  - Subdirectory support (e.g., `decisions/ADR-001.md`)
  - Optional base path override (requires `memory.allowRootOverride: true`)
  - No conflicts if Serena MCP also installed (aliases are opt-in)
  
- **Configuration Schema**:
  ```typescript
  {
    memory: {
      enabled: boolean;                   // Default: true
      root: string;                       // Default: ".cursor/memory/"
      allowSubdirs: boolean;              // Default: true
      registerSerenaAliases: boolean;     // Default: false
      allowRootOverride: boolean;         // Default: false (security)
    }
  }
  ```
  
- **Storage**: Markdown files in configurable path
- **Files Maintained**: `constitution.md`, `architecture.md`, `tech-stack.md`, `glossary.md`, `decisions/*.md`
- **Security**: Path normalization, no `..` traversal, root containment checks

#### FR-2: Meta-Learning Extraction Hook
- **Purpose**: Automatically extract OmO improvement insights before context is lost
- **Location**: `src/hooks/meta-learning-extractor/` (follows hook structure pattern)
- **Triggers**:
  | Trigger | Event | Purpose | Priority |
  |---------|-------|---------|----------|
  | Pre-compaction | `experimental.session.compacting` | Last chance before context loss | PRIMARY |
  | Session idle | `session.idle` | After work pauses (with cooldown + delta) | SECONDARY |
  
- **Execution Flow**:
  1. **Sync snapshot**: Persist transcript slice + metadata (fast, <100ms)
  2. **Background extraction**: Spawn background agent for LLM analysis (async, non-blocking)
  3. **Output**: Write to `context/learnings/{session_id}.md`
  
- **Noise Control**:
  - Cooldown: 10-20 min per session
  - Min delta: Require new messages since last extraction
  - Max candidates per run: 3-5
  - Dedup: Stable hash `(pattern_type + evidence_snippet + subsystem)`
  
- **State Management**:
  - Per-session: `{ inFlight, lastExtractTime, lastMessageHash, candidateCount }`
  - Cleanup on `session.deleted`

#### FR-3: Meta-Learning Extractor Agent
- **Purpose**: Background agent that extracts meta-level improvement insights
- **Model**: Gemini 2.5 Flash (1M context, $0.30/M input, $2.50/M output, fast latency)
- **Role**: Specialist (can write files to `context/learnings/`, subject to governance)
- **Input**: Serialized conversation history + metadata (session_id, files_modified, tools_used, delegation_events)
- **Meta-Learning Categories**:
  | Category | What It Improves | Example |
  |----------|------------------|---------|
  | **Agent Instructions** | Agent prompts, roles, capabilities | "OmO should delegate frontend work earlier" |
  | **Commands** | Slash command behavior, workflows | "/implement should check for tasks.md first" |
  | **Orchestration** | Delegation patterns, agent selection | "Use explore agent for file discovery, not grep" |
  | **Context Handling** | Memory management, compaction | "Extract learnings before 70% context usage" |
  | **Tool Usage** | Tool selection, efficiency | "Use LSP instead of grep for symbol search" |
  
- **NOT Extracted** (project-level, goes to memory tools):
  - Domain-specific coding patterns
  - Business logic decisions
  - Architecture for the USER's project
  
- **Output Format**: Markdown with candidates (claim, category, evidence, confidence)
- **Human Review**: Reviewer reads → decides actionable → uses `/specify` to create feature

#### FR-4: Manual Extraction Command
- **Command**: `/extract-learnings`
- **Location**: `.opencode/command/extract-learnings.md` (follows command pattern)
- **Behavior**:
  - Manually triggers meta-learning extraction
  - Spawns background extractor agent with current session
  - Returns: "Extraction started, results in context/learnings/{session_id}.md"
- **Use Cases**:
  - Safety net when automatic triggers didn't fire
  - User wants to ensure complex work is captured
  - Testing/debugging the extraction system

#### FR-5: Learning Candidate Storage
- **Location**: `context/learnings/` (configurable via `meta_learning.output_path`)
- **Filename**: `{session_id}.md` (one file per session, append with timestamps if multiple extractions)
- **Format**: Structured markdown with:
  ```markdown
  # Meta-Learning Candidates: {session_id}
  
  ## Metadata
  - Session ID: {id}
  - Timestamp: {iso8601}
  - Extraction Trigger: pre-compaction | idle | manual
  
  ## Candidates
  
  ### 1. [Category] {Short Title}
  **Insight**: {What to improve}
  **Evidence**: {Excerpt from session showing the pattern/issue}
  **Actionable**: {Specific change to make}
  **Priority**: High | Medium | Low
  ```
  
- **Write Strategy**: Atomic write (temp file → rename)
- **Archive**: Human reviewer moves to `context/learnings/archive/` after processing

#### FR-6: Configuration Schema
- **Memory Tools Config**:
  ```typescript
  {
    memory: {
      enabled: boolean;                   // Default: true
      root: string;                       // Default: ".cursor/memory/"
      allowSubdirs: boolean;              // Default: true
      registerSerenaAliases: boolean;     // Default: false
      allowRootOverride: boolean;         // Default: false
    }
  }
  ```
  
- **Meta-Learning Config**:
  ```typescript
  {
    meta_learning: {
      enabled: boolean;                   // Default: true
      trigger_on_compact: boolean;        // Default: true
      trigger_on_idle: boolean;           // Default: false (conservative)
      output_path: string;                // Default: "context/learnings/"
      cooldown_minutes: number;           // Default: 15
      max_candidates_per_run: number;     // Default: 5
    }
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
  - Typical session (10KB markdown): ~2.5k tokens input, ~1k tokens output = $0.0037 per analysis
  - Large session (50KB markdown): ~15k tokens input, ~3k tokens output = $0.0158 per analysis
  - Maximum input: 100k tokens (reserve capacity for instructions + output)
- **Implementation**:
  - Learning extraction: Focus on decision points, pattern discoveries, architectural changes (not full transcript)
  - Chat review: Summary + dimension scores + key excerpts (full transcript opt-in via --save-transcript)
  - Adaptive truncation when approaching limits
  - Pre-filtering via signal scoring reduces unnecessary agent spawns

#### NFR-3: Reliability
- **Requirement**: Learning candidates and reviews persist even if session terminates unexpectedly
- **Measures**:
  - Atomic file writes (write to temp, rename)
  - Job state machine: queued → running → succeeded/failed/canceled
  - Lock files with expiry (prevent duplicate processing)
  - Retry logic with exponential backoff for transient failures
  - Graceful degradation if Linear MCP unavailable (learnings/reviews still saved locally)
  - Learning candidates stored immediately (buffer-first approach)
- **Recovery**: On startup, sweep detects abandoned jobs (status=running, age>threshold) and marks them failed

#### NFR-4: Privacy and Security
- **Requirement**: Prevent accidental secret persistence
- **Measures**:
  - Secret detection patterns: API keys, tokens, passwords, private keys
  - Redaction: Replace detected secrets with `[REDACTED: {type}]`
  - Excerpt limits: Max 200 chars per code sample (configurable)
  - Local storage only by default
  - No external transmission without explicit configuration
  - Context files stored in `context/` (should be git-ignored)
  - Full transcripts only saved when explicitly requested (--save-transcript)

#### NFR-5: Cost Control
- **Requirement**: Predictable and controllable analysis costs
- **Measures**:
  - Pre-filtering via signal scoring: prevents unnecessary agent spawns (blocks 90-97% of sessions)
  - Per-session cooldown: prevents rapid re-triggers (default 60 min)
  - Daily budget cap: configurable max learnings per day (default 10)
  - Per-session limit: max 2 learning extractions per session
  - Token metering: log input/output tokens + cost per analysis
  - Manual review only (no auto-trigger for chat quality reviews)
- **Monitoring**: `/review-learnings --stats` shows aggregate cost data
- **Cost Estimate**: At $0.30/M input, $2.50/M output, typical session analysis costs $0.0037-$0.0158

#### NFR-6: Scalability
- **Requirement**: Handle high-volume usage gracefully
- **Targets**:
  - Support 1000+ learning candidate files without performance degradation
  - Support 1000+ review files without performance degradation
  - Batch processing handles 100+ reviews in single run
  - Concurrent background learning extractions (different sessions) supported
- **Measures**:
  - Incremental processing (only new/changed files)
  - Index/metadata for fast filtering
  - Concurrency limits (max 2-5 concurrent Linear API calls)
  - Rate limiting respect (honor Linear API throttles)
  - Pre-filtering reduces processing load by 90-97%

#### NFR-7: Tool-Agnostic Storage
- **Requirement**: Context storage independent of specific tools (not tied to .cursor or .serena)
- **Measures**:
  - All context stored in `context/` folder (configurable)
  - Standard file formats: markdown (.md), JSONL (.jsonl)
  - No proprietary formats or tool-specific metadata
  - Works with any editor/IDE that can read markdown
  - Can be version-controlled (if desired)
  - Easy to backup, migrate, or sync across machines

---

## File Structures

### Learning Candidate File Structure

```markdown
# Meta-Learning Candidates: {session_id}

## Metadata
- **Session ID**: {session_id}
- **Timestamp**: {iso8601_timestamp}
- **Extraction Trigger**: pre-compaction | idle | manual
- **Files Modified**: {count} ({file_list})
- **Delegation Events**: {count}

## Candidates

### 1. [Agent Instructions] OmO should delegate frontend work earlier

**Insight**: OmO attempts to edit React components directly instead of delegating to frontend-ui-ux-engineer.

**Evidence**:
```
User: "Add a dark mode toggle to the settings page"
OmO: <uses Edit tool to modify Settings.tsx directly>
Result: Generic toggle UI, not polished
```

**Actionable**: Update OmO agent prompt with BLOCKING gate: "For any UI/UX work, MUST delegate to frontend-ui-ux-engineer. Do not edit .tsx/.jsx files directly."

**Priority**: High

---

### 2. [Commands] /implement should check for tasks.md first

**Insight**: Users invoke /implement without running /tasks first, leading to unstructured implementation.

**Evidence**:
- Session had no tasks.md in spec folder
- Implementation proceeded ad-hoc without clear task breakdown
- Missed several requirements from spec.md

**Actionable**: Add preflight check to /implement command that validates tasks.md exists.

**Priority**: Medium

---

### 3. [Tool Usage] Use LSP find_references instead of grep for symbol search

**Insight**: Agent used grep to find usages of function `processPayment`, returned 500+ results with noise.

**Evidence**:
```
Agent: <grep pattern="processPayment">
Result: 45k tokens (tests, comments, docs, actual code mixed)
Agent: <manually filters through output>
```

**Actionable**: Add to agent instructions: "For symbol search, use lsp_find_references for precise results. Grep for text/content search only."

**Priority**: Low

---

## Extraction Notes
- **Total Candidates**: 3
- **Priority Breakdown**: 1 High, 1 Medium, 1 Low
- **Cost**: 12k input tokens, 2k output tokens, $0.009
```

---

## Technical Constraints

### 1. Pre-Compaction Hook Available (experimental.session.compacting)
**Discovery**: OpenCode provides `experimental.session.compacting` hook that fires **BEFORE** compaction starts.

```typescript
"experimental.session.compacting"?: (
  input: { sessionID: string }, 
  output: { context: string[] }
) => Promise<void>
```

**Trigger Strategy**:
| Trigger | Event | Priority | Purpose |
|---------|-------|----------|---------|
| Pre-compaction | `experimental.session.compacting` | PRIMARY | Last chance before context loss |
| Context threshold | 60% usage | PROACTIVE | Early extraction before pressure |
| Session idle | `session.idle` (debounced) | PERIODIC | After work pauses |
| Manual | `/extract-learnings` | ON-DEMAND | User-triggered |

**Implication**: We can reliably extract learnings BEFORE compaction, not after. This is the ideal trigger point.

---

### 2. Background Tasks Don't Inherit Context
**Constraint**: Background agents receive only the prompt text. No access to parent session context.

**Workaround**: Serialize conversation history into the background agent's prompt. Use structured format:

```markdown
TASK: Extract learnings from this development session

CONVERSATION HISTORY (serialized):
[Message 1 - User]: {content}
[Message 2 - Assistant]: {content}
[Tool: edit]: {file_path}, {changes}
...

METADATA:
- Session ID: {id}
- Files Modified: {list}
- Tools Used: {list}
- Signal Score: {score}
```

**Implication**: Prompt can get large for long conversations. Adaptive truncation focuses on decision points and architectural changes. Pre-filtering via signal scoring ensures only high-value sessions are processed.

---

### 3. Agent Role for File Writing
**Constraint**: Only specialist agents can write files (subject to governance).

**Design Decision**: Both context-learner and chat-auditor must be specialist role, not utility/advisor.

**Implication**: Both agents subject to governance-path-validator. Must ensure `context/` is in allowed paths.

---

### 4. Signal Scoring Requires Session Metadata
**Constraint**: Multi-signal scoring needs access to files_modified, tools_used, and conversation content.

**Workaround**: 
- Hook analyzes `ctx.client.session.messages()` for tool calls and file edits
- Extracts file paths from Edit/Write tool calls
- Scans conversation for decision language patterns
- Computes signal score before spawning agent

**Implication**: Signal scoring adds ~10-50ms overhead to session.idle event. Acceptable for cost savings (blocks 90-97% of agent spawns).

---

### 5. Governance Path Validator May Block Writes
**Constraint**: Default governance rules may block writes to `context/` if not in allowed paths.

**Workaround**: Explicitly add `context/` to `governance.path_validation.allowed_paths` in default config.

**Implication**: Initial setup must configure governance; otherwise learning extraction will fail silently.

---

### 6. Memory File Format Assumptions
**Constraint**: Programmatic editing of memory files (constitution, architecture, etc.) assumes consistent markdown format.

**Workaround**:
- Use structured format for memory files (headings, lists, sections)
- Anti-bloat guardrails detect format violations
- Fallback: Manual editing if programmatic promotion fails

**Implication**: Memory files must follow conventions. Document format in project setup.

---

## Success Criteria

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| **Memory Tool Compatibility** | 100% Serena API compatibility | Run Serena-based workflows, verify identical behavior |
| **Meta-Learning Quality** | 70% of extracted candidates lead to actionable `/specify` specs | Track conversion rate over 1 month |
| **Pre-Compaction Reliability** | 95% of compaction events trigger extraction successfully | Monitor hook execution success rate |
| **Non-Blocking Performance** | <100ms snapshot time on pre-compaction hook | Performance profiling of hook dispatch |
| **False Positive Rate** | <30% of extractions yield zero actionable candidates | Manual review sampling (N=30 sessions) |
| **Cost Efficiency** | Average extraction cost <$0.02 per session | Cost tracking: `sum(costs) / count(extractions)` |
| **Deduplication Effectiveness** | <10% duplicate candidates within 1 week | Dedup audit across time window |
| **Tool Adoption** | Memory tools used in 50%+ of agent sessions | Track tool call frequency vs baseline |

---

## Assumptions

1. **Learning Signal Accuracy**: Multi-signal scoring can reliably distinguish learning-worthy sessions (3-10%) from routine work (90-97%)
2. **Gemini 2.5 Flash Quality**: Gemini 2.5 Flash can accurately extract learnings and analyze conversations (verified by research showing 63.8% SWE-Bench performance)
3. **Linear MCP Availability**: Linear MCP is configured and functional for batch processing (graceful degradation if not)
4. **Session Idle/Compact Semantics**: `session.idle` and `session.compacted` reliably fire at appropriate times (verified by existing hook usage)
5. **File System Reliability**: Atomic rename operations work correctly on target platforms (macOS, Linux, Windows)
6. **Oh-my-opencode Knowledge Stability**: Agent's baked-in knowledge of oh-my-opencode architecture remains accurate across minor version updates
7. **Human Review Capacity**: Developers can review 1-3 learning candidates per week without overwhelming their workflow
8. **Memory File Structure**: Existing memory files (constitution, architecture, tech-stack, glossary) follow consistent markdown format for programmatic editing

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
| **False positive learning triggers**: Signal scoring detects "learnings" in routine sessions | Medium | Medium | Tunable threshold, veto conditions, human approval gate |
| **False negative learning triggers**: Signal scoring misses valuable learnings | Medium | Medium | Dual trigger (idle + compacted), manual review when needed, threshold tuning |
| **Learning candidate bloat**: Too many low-quality candidates accumulate in staging | Medium | Medium | Anti-bloat guardrails, confidence scoring, human approval gate, retention policy |
| **Memory file corruption**: Auto-promotion introduces errors/duplicates | Low | High | Buffer-first approach, human approval, atomic writes, version control |
| **Governance blocks writes**: Path validator prevents context file creation | Low | High | Add `context/` to default allowed paths, clear error messages |
| **Linear API rate limiting**: Batch processing hits 429 errors | Medium | Medium | Concurrency limit (2-5 parallel), exponential backoff, retry with jitter |
| **Secret leakage in candidates**: Conversation contains API keys that get persisted | Medium | Critical | Redaction patterns for common secrets, excerpt length limits, security audit |
| **Cost runaway**: Aggressive auto-trigger with low signal threshold | Low | Medium | Daily budget cap, per-session cooldown, pre-filtering via signal scoring |
| **Race condition on candidate write**: Concurrent extractions from same session | Low | Low | File locks with expiry, atomic writes, `inFlight` flag |
| **Background agent timeout**: Long conversations time out during analysis | Low | Medium | Timeout handling, partial candidate save, adaptive truncation |
| **Approval fatigue**: Users overwhelmed by too many candidates to review | Medium | Medium | High signal threshold (default 3/10), max 1-3 candidates/week target |

---

## Design Decisions

### DD-1: Gemini 2.5 Flash for Both Agents
**Decision**: Use Gemini 2.5 Flash for both context-learner and chat-auditor agents.

**Context**: Need a model for learning extraction and conversation analysis that balances cost, speed, and quality.

**Options Considered**:
1. Claude Sonnet 4.5 (high quality, moderate cost)
2. GPT-4o (high quality, moderate cost)
3. Gemini 2.5 Flash (good quality, very low cost, 1M context)

**Rationale**: 
- Cost: $0.30/M input vs $3/M for Claude/GPT (10x cheaper)
- Context window: 1M tokens handles even very large conversations
- Speed: Optimized for low latency
- Quality: 63.8% SWE-Bench Verified (sufficient for pattern detection and learning extraction)
- Structured output: Native JSON schema support
- Cost-efficient for frequent operations (learning extraction expected to trigger 1-10x/day)

**Trade-off**: Slightly lower reasoning quality than Claude Opus/GPT-5.2, but acceptable for analysis task. Pre-filtering via signal scoring ensures only high-quality sessions trigger analysis.

---

### DD-2: Session.Idle + Signal Scoring (Not Real-Time)
**Decision**: Trigger learning extraction on session.idle when signal score ≥ threshold, not in real-time during conversation.

**Context**: Wanted to capture learnings before context loss, but real-time monitoring would add overhead.

**Options Considered**:
1. Real-time monitoring: Hook every message, check signals constantly
2. Session.idle + signal scoring: Wait for idle, then compute signal score
3. Session.compacted only: Extract learnings after compaction
4. Manual-only: No auto-trigger, users must invoke /extract-learnings

**Rationale**:
- Performance: Real-time adds latency to every message
- Accuracy: session.idle is reliable trigger (proven by existing hooks)
- Signal scoring: Pre-filtering prevents 90-97% of unnecessary agent spawns
- Dual trigger: Both session.idle AND session.compacted ensure coverage
- Existing pattern: todo-continuation-enforcer uses same approach

**Trade-off**: May occasionally miss learnings if session ends abruptly. Dual trigger (idle + compacted) mitigates this.

---

### DD-3: context/ Folder for Tool-Agnostic Storage
**Decision**: Store all context in `context/` folder (not `.cursor/` or `.serena/`).

**Context**: Need storage location independent of specific tools.

**Options Considered**:
1. `.cursor/` or `.serena/`: Tool-specific locations
2. `.opencode/`: OpenCode-specific location
3. `context/`: Tool-agnostic, generic name

**Rationale**:
- Tool-agnostic: Works with any editor/IDE, not tied to Cursor or Serena
- Generic: Clear purpose without tool-specific naming
- Standard: Common pattern in projects (like `docs/`, `tests/`)
- Portable: Easy to backup, migrate, or version-control
- Future-proof: Survives tool switches

**Trade-off**: New folder convention (not following existing .cursor/.serena patterns). Accept for long-term flexibility.

---

### DD-4: Buffer-First Approach for Learnings
**Decision**: Write learning candidates to staging buffer (`context/learnings/`), require human approval before promoting to memory.

**Context**: Need to prevent bloat and noise in memory files while still capturing learnings automatically.

**Options Considered**:
1. Direct write: Auto-write to memory files
2. Buffer-first: Stage candidates, require approval
3. High-confidence auto-promote: Auto-write candidates with confidence >0.95

**Rationale**:
- Quality control: Human review prevents noise, redundancy, and low-quality entries
- Anti-bloat: Approval gate ensures only valuable learnings persist
- Trust building: System earns trust by showing candidates before persistence
- Flexibility: User can approve/reject/edit before promotion
- Safety: Mistakes in extraction don't corrupt memory files

**Trade-off**: Requires manual review step (mitigated by low candidate volume: 1-3/week). Can add auto-promote for high-confidence candidates later if desired.

---

### DD-5: Background Agent for All Analysis
**Decision**: Always run context-learner and chat-auditor in background, never block main conversation.

**Context**: Need to prevent main conversation blocking during analysis.

**Options Considered**:
1. Background for auto-trigger, synchronous for manual
2. Background always
3. Synchronous always

**Rationale**:
- Consistency: Same code path for auto + manual
- Performance: Even manual reviews can analyze large sessions
- User experience: Immediate feedback ("Analysis started..."), results arrive via notification
- Non-blocking: Main conversation continues immediately

**Trade-off**: Manual reviews feel less immediate (mitigated with progress updates). Accept for consistency and performance.

---

### DD-6: Multi-Signal Scoring for Learning Detection
**Decision**: Use multi-signal scoring (strong/medium/weak signals + veto conditions) to pre-filter sessions before spawning agent.

**Context**: Need to distinguish learning-worthy sessions (3-10%) from routine work (90-97%).

**Options Considered**:
1. Always extract: Spawn agent for every session
2. Signal scoring: Pre-filter based on session characteristics
3. ML-based: Train classifier on past sessions

**Rationale**:
- Cost efficiency: Pre-filtering prevents 90-97% of unnecessary agent spawns
- Signal diversity: Multiple signals (file edits, decision language, cross-file impact) capture different learning types
- Veto conditions: Blocks obvious non-learning sessions (single-file changes, speculation)
- Tunable: Threshold configurable per project (default: 3/10)
- Transparent: Signal scoring is explainable (vs. ML black box)

**Trade-off**: May miss some learnings if signal scoring is too conservative. Threshold tuning required per project.

---

### DD-7: 6-Point Quality Framework (Not Custom Per Project)
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

### DD-8: Meta-Learning Focus (Not General Chat Review)
**Decision**: Focus on meta-level improvements to OmO orchestration, not general chat quality scoring.

**Context**: Original spec had 6-point chat quality framework. Revised to focus on actionable improvements to the agentic workflow itself.

**Options Considered**:
1. 6-point chat quality framework (original spec)
2. Meta-learning focus on OmO improvement
3. Both (quality scoring + meta-learning)

**Rationale**:
- Actionability: Meta-learnings can become feature specs via `/specify`
- Focused scope: Improving OmO orchestration is more valuable than generic quality scores
- Human-in-the-loop: Reviewer decides what becomes a feature
- Reduced complexity: No need for quality framework scoring, pattern detection, Linear auto-creation

**Trade-off**: No quantitative quality scoring. Accept because meta-learnings are more actionable than scores.

---

## Open Questions

1. **Should context/ folder be git-committed or git-ignored by default?**
   - **Context**: Context files contain project knowledge (learnings, reviews, transcripts)
   - **Options**: 
     - A) Git-ignored by default (local-only)
     - B) Git-committed by default (shared knowledge)
     - C) Configurable per subfolder (learnings committed, transcripts ignored)
   - **Recommendation**: Start with A (git-ignored), let users opt-in to version control if desired

2. **Should high-confidence learnings (>0.95) be auto-promoted without human review?**
   - **Context**: Some learnings may be obvious enough to skip approval step
   - **Options**:
     - A) All candidates require approval (current design)
     - B) Auto-promote if confidence >0.95
     - C) Configurable: `auto_promote_confidence: number` (default: 1.0, i.e., disabled)
   - **Recommendation**: Start with A (all require approval), add B if users request it after seeing candidate quality

3. **What is the retention policy for old learning candidates and reviews?**
   - **Context**: Candidates and reviews accumulate over time, potentially 100s of files
   - **Options**:
     - A) Keep forever
     - B) Prune after N days: `retention_days: number`
     - C) Archive processed items: move to `context/learnings/archive/` and `context/reviews/archive/`
   - **Recommendation**: Start with A (keep forever), add C if storage becomes issue

4. **Should pattern detection create Linear issues automatically or require approval?**
   - **Context**: When 3+ reviews flag same category, /process-reviews can auto-create "systemic issue" Linear issue
   - **Options**:
     - A) Auto-create with label `auto-detected-pattern`
     - B) Dry-run: Show what would be created, require --approve flag
     - C) Interactive: Prompt for confirmation per pattern
   - **Recommendation**: Start with B (dry-run by default), add --auto-create flag for CI/cron

5. **Should signal scoring thresholds be adaptive based on project characteristics?**
   - **Context**: Default threshold (3/10) may need tuning per project
   - **Options**:
     - A) Fixed threshold across all projects (current design)
     - B) Adaptive: Learn optimal threshold based on approval rate
     - C) Project-specific: Allow override in config
   - **Recommendation**: Start with A (fixed), add C (configurable) if users request it

---

## Out of Scope

The following are explicitly **not** included in this feature:

1. **Chat quality framework**: No 6-point scoring (Task Completion, Agent Utilization, etc.)
2. **Automated Linear issue creation**: No `/process-reviews` command
3. **Pattern detection across sessions**: No aggregation or trend analysis
4. **Full transcript storage**: No JSONL session archival
5. **Review file structure**: No chat quality review markdown files
6. **Automatic memory file updates**: Meta-learnings buffered for human review, not auto-applied to `.cursor/memory/`
7. **Signal scoring system**: Simplified triggers (pre-compaction + idle), no multi-signal scoring
8. **Project-level learning extraction**: Focus is meta-learning (OmO improvements), not project-specific patterns
9. **Cross-project aggregation**: Each project's learnings are independent
10. **Multi-user collaboration**: Single-user workflow
11. **Integration with external knowledge bases**: Local storage only
12. **Real-time extraction during conversation**: Post-session extraction only (pre-compaction/idle)
