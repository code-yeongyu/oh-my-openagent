# Read-Before-Write Enforcement Hook

**Linear Issue**: [LIF-103](https://linear.app/lifelogger/issue/LIF-103/read-before-write-enforcement-hook)
**Created**: 2025-12-28
**Status**: Ready for Planning
**Hook Name**: `read-before-write`

## Overview

A safety mechanism that prevents AI agents from editing files they haven't read, eliminating wasted computational resources and latency from failed edit attempts. This hook enforces best practices by ensuring agents have proper context before making modifications.

## Problem Statement

### Current State

AI agents using the oh-my-opencode plugin frequently attempt to edit files without first reading them. The underlying platform (OpenCode) already rejects these operations with an error message, but by the time this happens, significant resources have been wasted.

Current mitigation relies on prompt-based guidance (GATE 2 in the OmO agent) which achieves approximately 70% compliance. This leaves 30% of edit attempts failing, causing:

### Issues

1. **Wasted Tokens**: Each failed edit attempt consumes 500-2,000 tokens before failing, including the agent's reasoning, the file content in the request, and the error response
2. **Latency Impact**: Failed attempts add 2-5 seconds of round-trip time per occurrence
3. **Retry Overhead**: Agents must then read the file and retry, doubling the operation time
4. **Compounding Costs**: In multi-agent orchestration workflows, these failures cascade across delegated tasks
5. **Poor User Experience**: Users waiting on agent output experience unnecessary delays
6. **Context Window Pressure**: Wasted tokens contribute to earlier context compaction

## User Stories

### US-1: As an AI agent developer

I want agents to be automatically prevented from editing unread files  
So that I don't waste money and time on failed edit operations

**Acceptance Criteria:**
- [ ] When an agent attempts to edit a file it hasn't read, the operation is blocked BEFORE consuming tokens on the edit payload
- [ ] The blocking error message clearly instructs the agent to read the file first
- [ ] The error includes the specific file path that needs to be read
- [ ] Token consumption for the blocked operation is minimal (error message only)

### US-2: As a user running multi-agent workflows

I want read-before-write enforcement to work across all agents in a session  
So that parallel agent execution doesn't waste resources on predictable failures

**Acceptance Criteria:**
- [ ] Each agent session maintains its own list of files read
- [ ] Background agents (running in separate sessions) have isolated read tracking
- [ ] Main agent and delegated agents each track their own reads independently
- [ ] No cross-contamination between agent sessions

### US-3: As a plugin user

I want to configure read-before-write enforcement to match my workflow  
So that I can balance strictness with flexibility

**Acceptance Criteria:**
- [ ] Users can enable or disable the feature entirely
- [ ] Users can choose between "block" (prevent edit) and "warn" (log but allow) modes
- [ ] Users can exempt specific tools from enforcement (e.g., LSP tools, memory tools)
- [ ] Users can exempt specific file paths or patterns (e.g., generated files, build outputs)
- [ ] Configuration changes take effect without restarting the session

### US-4: As a developer creating new files

I want to create new files without needing to read them first  
So that file creation workflows remain smooth

**Acceptance Criteria:**
- [ ] Creating a brand-new file (that doesn't exist) is allowed without prior read
- [ ] The system correctly distinguishes between "file exists but unread" and "file doesn't exist"
- [ ] Editing a file immediately after creating it works without explicit read
- [ ] The distinction is made at enforcement time, not at tracking time
- [ ] When a new file is created via `write` tool, it is automatically tracked as "read" so subsequent edits are allowed

### US-5: As a user of LSP-based refactoring

I want LSP operations like rename and code actions to work without manual reads  
So that semantic code operations aren't hindered by the enforcement

**Acceptance Criteria:**
- [ ] LSP rename operations are exempt from read-before-write checks
- [ ] LSP code action applications are exempt from read-before-write checks
- [ ] The exemption is based on tool identity, not file path
- [ ] Other non-LSP edits to the same files still require prior reads

## Requirements

### Functional Requirements

#### FR-1: File Read Tracking

The system must track every file read operation performed by each agent within a session. Tracking must:
- Intercept the `read` tool via `tool.execute.before` (args are only available in before hook, not after)
- Record the absolute file path normalized using `path.resolve()` to prevent path variations (e.g., `./file` vs `/full/path/file`)
- Handle multiple argument names: `filePath`, `file_path`, `path`
- Associate each read with the session that performed it
- Store reads in an LRU cache structure using JavaScript Map's insertion-order guarantee for O(1) operations
- Persist for the duration of the agent session
- Be queryable to determine if a file has been read
- Clean up session data on `session.deleted` and `session.compacted` events

**SDK Constraint**: The OpenCode plugin SDK's `tool.execute.after` hook does NOT have access to `output.args` (only `title`, `output`, `metadata`). Therefore, read tracking MUST occur in `tool.execute.before` where args are available.

#### FR-2: Write/Edit Interception

The system must intercept all file modification operations before they execute. Interception must:
- Capture `write` tool invocations
- Capture `edit` tool invocations
- Capture `multiedit` tool invocations (batch file modifications)
- Extract the target file path from the operation
- For `multiedit`, check each file in the edit list individually
- Occur before any token-consuming operation on the edit content

#### FR-3: Enforcement Decision

The system must evaluate each write/edit operation against the read tracking. The decision must:
- Check if the target file exists (for new file creation exemption)
- Check if the target file was previously read in the current session
- Apply configured exemptions (tools, paths)
- Return an actionable decision (allow, warn, block)

#### FR-4: Error Messaging

When blocking an operation, the system must provide clear guidance. The message must:
- Identify which file needs to be read
- Instruct the agent to use the Read tool
- Be parseable by AI agents for automatic correction
- Avoid jargon or ambiguous language

**Standard Error Format:**
```
[BLOCKED] Read-Before-Write: Cannot edit file without reading it first.
File: {filePath}
Action: Use the Read tool to read "{filePath}" before editing.
```

**Standard Warning Format (warn mode):**
```
[WARNING] Read-Before-Write: Editing file without prior read: {filePath}
Consider reading files before editing to ensure you have the latest content.
```

**Note**: ASCII prefixes (`[BLOCKED]`, `[WARNING]`) are used instead of emoji for terminal compatibility.

#### FR-5: Configuration Management

The system must allow users to customize enforcement behavior. Configuration must:
- Support enabling/disabling the feature
- Support multiple enforcement modes (block, warn, disabled)
- Support tool exemptions via a list of tool names
- Support path exemptions via pattern matching (glob patterns)
- Load from the standard oh-my-opencode configuration file

**Configuration Schema:**
```json
{
  "governance": {
    "read_before_write": {
      "enabled": true,
      "mode": "block",
      "exempt_tools": [
        "lsp_rename",
        "lsp_code_action_resolve",
        "ast_grep_replace",
        "memory_write",
        "memory_edit",
        "memory_delete",
        "create_spec_folder",
        "update_workflow_state"
      ],
      "exempt_paths": [
        "dist/**",
        "build/**",
        "node_modules/**",
        ".git/**"
      ]
    }
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable the hook entirely |
| `mode` | `"block"` \| `"warn"` \| `"disabled"` | `"block"` | Enforcement mode |
| `exempt_tools` | string[] | See above | Tools that bypass enforcement |
| `exempt_paths` | string[] | See above | Glob patterns for exempt paths |

#### FR-6: Session Lifecycle Management

The system must properly manage session state throughout its lifecycle:
- Initialize tracking state lazily on first read operation
- Clean up session tracking data when `session.deleted` event fires (access via `props?.info?.id`)
- Clean up session tracking data when `session.compacted` event fires (use defensive pattern: `props?.sessionID ?? props?.info?.id`)
- Handle missing or undefined session IDs gracefully (log warning, allow operation)
- Bound memory usage by limiting tracked files per session (max 10,000 files) via LRU eviction

**Session ID Access Pattern** (per codebase convention):
```typescript
// session.deleted - use props.info.id
if (event.type === "session.deleted") {
  const sessionInfo = props?.info as { id?: string } | undefined;
  if (sessionInfo?.id) { /* cleanup */ }
}

// session.compacted - use defensive fallback
if (event.type === "session.compacted") {
  const sessionID = (props?.sessionID ??
    (props?.info as { id?: string } | undefined)?.id) as string | undefined;
  if (sessionID) { /* cleanup */ }
}
```

### Non-Functional Requirements

#### NFR-1: Performance

- Tracking overhead must be negligible (<1ms per read operation)
- Enforcement check must complete in <5ms
- Memory usage for tracking must be bounded (e.g., max 10,000 tracked files per session)

#### NFR-2: Reliability

- Enforcement must not crash or hang the main session
- Failures in tracking should fail open (allow operation) not fail closed
- The feature must degrade gracefully if configuration is malformed

#### NFR-3: Observability

- Enforcement decisions (allow, warn, block) should be logged
- Blocked operations should be clearly visible in session logs
- Statistics should be available for debugging (files tracked, operations blocked)

#### NFR-4: Compatibility

- Must work with existing oh-my-opencode hooks without conflicts
- Must integrate with the existing hook configuration system
- Must be consistent with patterns used by similar hooks (conflict-detector, governance-path-validator)

## Scope

### In Scope

- Tracking file reads via the `read` tool
- Enforcing read-before-write for `write`, `edit`, and `multiedit` tools
- Per-session tracking with agent session isolation
- Configuration via oh-my-opencode.json
- Exemptions for specific tools (LSP, memory tools)
- Exemptions for specific path patterns
- New file creation exemption
- Clear error messaging for blocked operations

### Out of Scope

- Tracking reads performed via other means (e.g., LSP hover, grep snippets)
- Cross-session tracking (reading in one session doesn't count for another)
- Persistence of tracking across session restarts
- Automatic read injection (automatically reading the file for the agent)
- Integration with external file tracking systems
- Tracking reads from tools other than the `read` tool
- Tracking partial reads (offset/limit parameters)

## Assumptions

1. The `read` tool is the canonical way agents read files, and tracking it captures the meaningful intent
2. LSP operations have sufficient semantic understanding that they don't need explicit file reads
3. Memory tools operate on controlled paths that don't benefit from read-before-write enforcement
4. Generated files (dist/, build/, etc.) are typically written programmatically, not by agents reading and modifying
5. Session boundaries provide natural isolation for tracking - no need for cross-session awareness
6. The existing hook system (`tool.execute.before`, `tool.execute.after`) provides sufficient interception points
7. File existence checks are fast enough to perform inline during enforcement

## Dependencies

### Technical Dependencies

- OpenCode Plugin API (`@opencode-ai/plugin`) for hook integration
- Existing hook system patterns (conflict-detector registry pattern)
- File system access for existence checks
- Configuration system from oh-my-opencode

### External Dependencies

- None - this is a self-contained enforcement mechanism

## Success Criteria

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Failed edit reduction | 95% reduction in "must read first" errors | Compare error rate before/after deployment |
| Performance impact | <5ms added latency per operation | Instrumented timing in enforcement checks |
| User adoption | >80% of users keep feature enabled | Configuration telemetry (if available) |
| Agent compliance | 100% enforcement when enabled in block mode | No bypass of enforcement mechanism |
| False positive rate | <1% of legitimate operations blocked | User feedback and issue reports |

## Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Legitimate workflows blocked | Medium | High | Comprehensive exemption system, warn mode for gradual rollout |
| Performance degradation | Low | Medium | Efficient tracking data structure, lazy initialization |
| Configuration complexity | Medium | Low | Sensible defaults, clear documentation, schema validation |
| Interaction with other hooks | Low | Medium | Integrate with existing patterns, thorough testing |
| Memory leaks in long sessions | Low | Medium | Bounded tracking structure, cleanup mechanisms |

## Design Decisions

### DD-1: Registry Pattern for Tracking with LRU Cache

**Decision**: Use a singleton registry pattern with an LRU (Least Recently Used) cache for tracking read files

**Context**: Need to maintain read state across multiple hook invocations within a session, with bounded memory usage

**Options Considered**:
1. Global Map - Simple but no session isolation
2. Per-hook instance state - Complex lifecycle management
3. Singleton registry with session keys and Set - Proven pattern but no LRU
4. Singleton registry with LRU cache per session - Best of both worlds

**Rationale**: The conflict-detector's FileEditRegistry provides a battle-tested pattern for session-scoped state management. Enhanced with an LRU cache using JavaScript Map's insertion-order guarantee for O(1) operations:
- `Map.keys().next().value` returns oldest entry (first inserted)
- Delete and re-insert on access moves item to end (most recently used)
- O(1) lookup, O(1) insertion, O(1) eviction

**Data Structure**:
```typescript
// Session-scoped LRU cache: Map<path, timestamp>
// - path: normalized absolute file path
// - timestamp: when the file was read (for diagnostics)
// - Map insertion order provides LRU semantics
Map<sessionId, Map<normalizedPath, timestamp>>
```

### DD-2: Exemption by Tool Name vs Tool Pattern

**Decision**: Exempt tools by exact tool name match, not by pattern

**Context**: Need to exempt LSP tools, memory tools, and potentially user-specified tools

**Options Considered**:
1. Exact tool name list - Simple, explicit
2. Regex pattern matching - Flexible but error-prone
3. Tool category/tag system - Requires metadata not available

**Rationale**: Tool names are stable identifiers. Exact matching is predictable and easy to configure. Users can list multiple tools if needed.

### DD-3: File Existence Check Timing

**Decision**: Check file existence during enforcement, not during tracking

**Context**: New files should be writable without prior read, but we don't know at read time if a file will be created

**Options Considered**:
1. Check at tracking time - Can't predict future file creation
2. Check at enforcement time - Accurate, slight overhead
3. Track file existence separately - Complex, redundant

**Rationale**: Checking existence during enforcement captures the most accurate state. The slight overhead is acceptable given the low frequency of write operations relative to the session duration.

### DD-4: Partial File Reads

**Decision**: Partial reads (with offset/limit parameters) count as having read the file

**Context**: Agents may read only portions of large files to save tokens

**Options Considered**:
1. Count partial reads as full reads - Simple, permissive
2. Track read ranges and require coverage - Complex, over-engineered
3. Don't count partial reads - Too restrictive, breaks legitimate workflows

**Rationale**: The intent of the hook is to ensure the agent has *some* context about the file before editing. A partial read demonstrates this intent. Tracking exact byte ranges would add complexity without proportional benefit.

### DD-5: Glob/Grep Context

**Decision**: Glob and grep results do NOT count as file reads

**Context**: These tools return file paths or snippets, not full file content

**Options Considered**:
1. Count as partial reads - Blurs the line between discovery and reading
2. Don't count - Clear boundary, consistent with "read tool" tracking
3. Track separately as "discovered" files - Over-engineered

**Rationale**: The read-before-write enforcement is specifically about the `read` tool as the canonical way to gain file context. Glob and grep are discovery tools, not context tools. Users who find files via grep still need to read them before editing.

### DD-6: Subagent Session Isolation

**Decision**: Subagents do NOT inherit the parent agent's read list

**Context**: When delegating to subagents, should they share read tracking?

**Options Considered**:
1. Inherit parent reads - Complicates session management, unclear boundaries
2. Isolated sessions - Clean separation, each agent responsible for own context
3. Configurable inheritance - Added complexity for edge case

**Rationale**: Session isolation is the established pattern in oh-my-opencode (see conflict-detector). Each agent session is independent. Subagents are expected to read files they need to edit, which is actually beneficial as it ensures they have fresh context rather than relying on potentially stale parent reads.

### DD-7: AST-Grep Replace Exemption

**Decision**: `ast_grep_replace` is EXEMPT from read-before-write enforcement

**Context**: This tool performs semantic AST-based code refactoring when `dryRun: false`

**Options Considered**:
1. Enforce - Treat like regular edit operations
2. Exempt - Trust semantic operations like LSP tools

**Rationale**: `ast_grep_replace` is a semantic refactoring operation similar to LSP tools. The agent uses AST patterns to make targeted changes, which implies understanding of code structure. When `dryRun: false` is explicitly set, the agent has made a deliberate decision to apply changes. This is consistent with exempting `lsp_rename` and `lsp_code_action_resolve`.

### DD-8: Write Operations Track as Read

**Decision**: When creating a new file via `write` tool, automatically track it as "read"

**Context**: Agents often create a file then immediately edit it. Without tracking writes, the edit would be blocked.

**Options Considered**:
1. Don't track writes - Would block legitimate create-then-edit workflows
2. Track all writes as reads - Could mask issues where agent overwrites without context
3. Track writes to NEW files only as reads - Best balance

**Rationale**: When an agent creates a new file, it clearly has full context about the content (it just wrote it). Tracking this as a "read" allows subsequent `edit` operations without requiring an explicit `read` tool call. This only applies to files that don't exist at write time - overwriting an existing file still requires prior read. This aligns with US-4's acceptance criteria.

## Known Limitations

The following limitations are accepted and documented:

### Path Normalization Edge Cases

1. **Symlinks**: If a file is read via `/real/path/file.ts` and edited via `/symlink/file.ts`, the paths won't match after `path.resolve()`. The edit will be blocked despite the file content being known.

2. **Case Sensitivity on macOS**: macOS filesystems are case-insensitive, but `path.resolve()` preserves case. Reading `File.ts` then editing `file.ts` may be blocked.

3. **Windows UNC Paths**: Network paths like `\\server\share\file` have different normalization behavior.

**Mitigation**: These are rare edge cases. Users experiencing issues can:
- Use consistent casing in their workflows
- Add problematic paths to `exempt_paths` configuration
- Use `mode: "warn"` to identify issues without blocking

### Race Conditions

A file created by another process between the `existsSync()` check and the actual write may bypass read-before-write. This is an acceptable edge case given the intended use (AI agent workflows, not concurrent systems).

### LRU Cache Eviction

When the LRU cache reaches its limit (10,000 files per session), the oldest entries are evicted. If an agent reads a file early in a long session, reads 10,000+ more files, then tries to edit the first file, it will be blocked because the original read was evicted. 

**Mitigation**: This is an extremely rare edge case (agents rarely touch 10,000+ files in a session). Users experiencing this can:
- Increase the cache limit via configuration (future enhancement)
- Re-read the file before editing
- Use `mode: "warn"` to allow the operation with a warning

### SDK Constraint: Args in After Hook

The OpenCode plugin SDK provides `output.args` only in `tool.execute.before`, not in `tool.execute.after`. This constraint required tracking reads in the before hook rather than after completion. The trade-off is that reads are tracked even if the read operation fails, but this is acceptable since failed reads are rare and the impact is minimal (allowing an edit that might fail anyway).
