# MCP Loader Plugin - Orchestration Notepad

## Task Started
All tasks execution STARTED: Thu Dec 4 16:52:57 KST 2025

---

## Orchestration Overview

**Todo List File**: ./tool-search-tool-plan.md
**Total Tasks**: 5 (Phase 1-5)
**Target Files**:
- `~/.config/opencode/plugin/mcp-loader.ts` - Main plugin
- `~/.config/opencode/mcp-loader.json` - Global config example
- `~/.config/opencode/plugin/mcp-loader.test.ts` - Unit tests

---

## Accumulated Wisdom

(To be populated by executors)

---

## Task Progress

| Task | Description | Status |
|------|-------------|--------|
| 1 | Plugin skeleton + config loader | pending |
| 2 | MCP server registry + lifecycle | pending |
| 3 | mcp_search + mcp_status tools | pending |
| 4 | mcp_call tool | pending |
| 5 | Documentation | pending |

---


## 2025-12-04 16:58 - Task 1 Completed

### Summary
- Created `~/.config/opencode/plugin/mcp-loader.ts` - Plugin skeleton with config loader
- Created `~/.config/opencode/plugin/mcp-loader.test.ts` - 14 unit tests

### Key Implementation Details
- Config merge: project overrides global for same server names, merges different
- Env var substitution: `{env:VAR}` → `process.env.VAR`
- Validation: type required, local needs command, remote needs url
- Empty config returns `{ servers: {} }` (not error)

### Test Results
- 14 tests passed
- substituteEnvVars: 4 tests
- substituteHeaderEnvVars: 1 test
- loadConfig: 9 tests

### Files Created
- `~/.config/opencode/plugin/mcp-loader.ts`
- `~/.config/opencode/plugin/mcp-loader.test.ts`

---

## [2025-12-08 18:56] - Task 1: Remove unused import formatWorkspaceEdit from LSP tools

### DISCOVERED ISSUES
- None - simple import cleanup task

### IMPLEMENTATION DECISIONS
- Removed only `formatWorkspaceEdit` from import list at line 17
- Kept all other imports intact (formatCodeActions, applyWorkspaceEdit, formatApplyResult remain)
- Verified the function exists in utils.ts:212 but is truly unused in tools.ts

### PROBLEMS FOR NEXT TASKS
- None identified for remaining tasks

### VERIFICATION RESULTS
- Ran: `bun run typecheck` → exit 0, no errors
- Ran: `bun run build` → exit 0, bundled 200 modules
- Ran: `rg "formatWorkspaceEdit" src/tools/lsp/tools.ts` → no matches (confirmed removal)

### LEARNINGS
- Convention: This project uses `bun run typecheck` (tsc --noEmit) and `bun run build` for verification
- The `formatWorkspaceEdit` function still exists in utils.ts - it's exported but just not used in tools.ts

소요 시간: ~2분

---

## [2025-12-08 19:00] - Task 2: Remove unused ThinkingPart interface and fallbackRevertStrategy function

### DISCOVERED ISSUES
- None - both items were genuinely unused (no callers found)

### IMPLEMENTATION DECISIONS
- Removed `ThinkingPart` interface (lines 37-40) - defined but never referenced
- Removed `fallbackRevertStrategy` function (lines 189-244) - defined but never called
- Added comment explaining removal reason as per task requirements
- Kept `ThinkingPartType`, `prependThinkingPart`, `stripThinkingParts` - these are different items and ARE used

### PROBLEMS FOR NEXT TASKS
- None identified

### VERIFICATION RESULTS
- Ran: `bun run typecheck` → exit 0, no errors
- Ran: `bun run build` → exit 0, bundled 200 modules
- Ran: `rg "ThinkingPart" src/hooks/session-recovery/` → only related types/functions found, interface removed
- Ran: `rg "fallbackRevertStrategy" src/hooks/session-recovery/` → only comment found, function removed
- Ran: `rg "createSessionRecoveryHook" src/hooks/` → exports intact

### LEARNINGS
- `ThinkingPart` interface vs `ThinkingPartType` type vs `prependThinkingPart` function - different entities, verify before removing
- `fallbackRevertStrategy` was likely a planned feature that never got integrated into the recovery flow

소요 시간: ~2분

---

## [2025-12-08 19:04] - Task 3: Remove unused builtinMcps export from MCP module

### DISCOVERED ISSUES
- None - `builtinMcps` export was genuinely unused (no external importers)

### IMPLEMENTATION DECISIONS
- Removed `export const builtinMcps = allBuiltinMcps` from line 24
- Kept `allBuiltinMcps` const - used internally by `createBuiltinMcps` function
- Kept `createBuiltinMcps` function - actively used in src/index.ts:89

### PROBLEMS FOR NEXT TASKS
- None identified

### VERIFICATION RESULTS
- Ran: `bun run typecheck` → exit 0, no errors
- Ran: `bun run build` → exit 0, bundled 200 modules
- Ran: `rg "builtinMcps" src/mcp/index.ts` → no matches (export removed)
- Ran: `rg "createBuiltinMcps" src/mcp/index.ts` → function still exists

### LEARNINGS
- `createBuiltinMcps` function vs `builtinMcps` export - function is used, direct export is not
- Internal const `allBuiltinMcps` should be kept since it's referenced by the function

소요 시간: ~2분

---

## [2025-12-09 16:13] - Task 1: Add file-based logger to shared module

### DISCOVERED ISSUES
- None - straightforward file copy and modification task

### IMPLEMENTATION DECISIONS
- Copied logger.ts from opencode-cc-plugin source
- Changed log file path from `opencode-cc-plugin.log` to `oh-my-opencode.log`
- Added barrel export from `src/shared/index.ts`
- Kept original comment for module description

### PROBLEMS FOR NEXT TASKS
- None identified - logger is now available for use in all new loaders

### VERIFICATION RESULTS
- Ran: `bun run typecheck` → exit 0, no errors
- Log file path verified: `/tmp/oh-my-opencode.log`
- Exports verified: `log()` and `getLogFilePath()` now accessible via `src/shared`

### LEARNINGS
- Source file location: `~/local-workspaces/opencode-cc-plugin/src/shared/logger.ts`
- Logger uses `fs.appendFileSync` for synchronous file writing
- Empty catch block intentionally swallows errors to prevent logging from breaking main operations

소요 시간: ~1분

---

## [2025-12-09 16:14] - Task 3: Rename skill-loader to claude-code-skill-loader

### DISCOVERED ISSUES
- None - straightforward directory rename task

### IMPLEMENTATION DECISIONS
- Used `mv` command to rename `src/features/skill-loader/` → `src/features/claude-code-skill-loader/`
- Updated import path in `src/index.ts` (lines 19-22)
- Did NOT modify internal imports (`../command-loader/types`) since command-loader still exists (Task 2 runs in parallel)

### PROBLEMS FOR NEXT TASKS
- If Task 2 renames command-loader to claude-code-command-loader, the internal imports in claude-code-skill-loader will need to be updated as part of Task 2's scope
- The skill-loader's loader.ts:6 and types.ts:1 import from `../command-loader/types`

### VERIFICATION RESULTS
- Ran: `bun run typecheck` → exit 0, no errors
- Ran: `bun run build` → exit 0, succeeded
- Directory structure verified: `skill-loader/` deleted, `claude-code-skill-loader/` exists

### LEARNINGS
- This project uses `mv` for directory rename (acceptable per ANTI-PATTERNS - file creation is forbidden, not rename)
- Command: `bun run typecheck` for type check, `bun run build` for build
- skill-loader internal imports use relative paths (`../command-loader/types`) which remain valid after rename

소요 시간: ~2분

---

## [2025-12-09 16:16] - Task 2: Rename command-loader to claude-code-command-loader

### DISCOVERED ISSUES
- skill-loader (now claude-code-skill-loader) was importing `CommandDefinition` from `../command-loader/types`
- After renaming command-loader, these references also needed updating

### IMPLEMENTATION DECISIONS
- Used `mv` command: `src/features/command-loader/` → `src/features/claude-code-command-loader/`
- Updated import path in `src/index.ts` (lines 13-18)
- Also updated `claude-code-skill-loader/loader.ts:6` and `types.ts:1` to reference new path

### PROBLEMS FOR NEXT TASKS
- None identified - all dependent imports updated

### VERIFICATION RESULTS
- Ran: `bun run typecheck` → exit 0, no errors
- Directory structure verified: `command-loader/` deleted, `claude-code-command-loader/` exists
- All imports updated: src/index.ts, claude-code-skill-loader/loader.ts, claude-code-skill-loader/types.ts

### LEARNINGS
- skill-loader depends on command-loader's `CommandDefinition` type via relative import
- When renaming shared modules, must update ALL dependent modules' imports
- Task 2 and Task 3 have an implicit dependency through the type import

소요 시간: ~2분

---

## [2025-12-09 16:24] - Task 4: Add claude-code-agent-loader feature

### DISCOVERED ISSUES
- None - straightforward file copy task

### IMPLEMENTATION DECISIONS
- Copied 3 files from opencode-cc-plugin: `index.ts`, `loader.ts`, `types.ts`
- Import path `../../shared/frontmatter` unchanged - already compatible with oh-my-opencode structure
- No `log()` usage in source files - no logger integration needed

### PROBLEMS FOR NEXT TASKS
- None identified - agent-loader is self-contained

### VERIFICATION RESULTS
- Ran: `bun run typecheck` → exit 0, no errors
- Directory structure verified: `claude-code-agent-loader/` created with 3 files
- Functions exported: `loadUserAgents()`, `loadProjectAgents()`

### LEARNINGS
- Source location: `~/local-workspaces/opencode-cc-plugin/src/features/agent-loader/`
- Agent loader uses `parseFrontmatter` from shared module
- Agent configs loaded from `~/.claude/agents/` (user) and `.claude/agents/` (project)
- Scope is appended to description: `(user)` or `(project)`

소요 시간: ~1분

---

## [2025-12-09 16:25] - Task 5: Add claude-code-mcp-loader feature

### DISCOVERED ISSUES
- None - straightforward file copy task

### IMPLEMENTATION DECISIONS
- Copied 5 files from opencode-cc-plugin: `index.ts`, `loader.ts`, `transformer.ts`, `env-expander.ts`, `types.ts`
- Import path `../../shared/logger` unchanged - already compatible with oh-my-opencode structure
- Kept `Bun.file()` usage - oh-my-opencode targets Bun runtime
- Environment variable expansion supports `${VAR}` and `${VAR:-default}` syntax

### PROBLEMS FOR NEXT TASKS
- None identified - mcp-loader is self-contained
- Does NOT conflict with src/mcp/ (builtin MCPs are separate)

### VERIFICATION RESULTS
- Ran: `bun run typecheck` → exit 0, no errors
- Directory structure verified: `claude-code-mcp-loader/` created with 5 files
- Functions exported: `loadMcpConfigs()`, `formatLoadedServersForToast()`, `transformMcpServer()`, `expandEnvVars()`, `expandEnvVarsInObject()`

### LEARNINGS
- Source location: `~/local-workspaces/opencode-cc-plugin/src/features/mcp-loader/`
- MCP configs loaded from:
  - `~/.claude/.mcp.json` (user scope)
  - `.mcp.json` (project scope)
  - `.claude/.mcp.json` (local scope)
- Later scope overrides earlier scope for same server name
- Supports stdio, http, and sse server types

소요 시간: ~1분

---

## [2025-12-09 16:24] - Task 6: Add claude-code-session-state feature

### DISCOVERED ISSUES
- None - straightforward file copy task

### IMPLEMENTATION DECISIONS
- Copied 4 files from opencode-cc-plugin: `types.ts`, `state.ts`, `detector.ts`, `index.ts`
- No import path changes needed - files are completely self-contained
- No external dependencies - types are defined locally

### PROBLEMS FOR NEXT TASKS
- Task 7 should import from `./features/claude-code-session-state` in src/index.ts
- Task 7 should remove local session variables and use the module's getter/setters

### VERIFICATION RESULTS
- Directory created: `src/features/claude-code-session-state/` (4 files confirmed)
- Exports available: sessionErrorState, sessionInterruptState, subagentSessions, sessionFirstMessageProcessed (Maps/Sets)
- Exports available: currentSessionID, currentSessionTitle, mainSessionID (state vars)
- Exports available: setCurrentSession(), setMainSession(), getCurrentSessionID(), getCurrentSessionTitle(), getMainSessionID() (getters/setters)
- Exports available: detectInterrupt() function

### LEARNINGS
- Session state module is completely self-contained - no external dependencies
- Uses barrel export pattern: index.ts re-exports everything from types, state, detector
- Source directory: `~/local-workspaces/opencode-cc-plugin/src/features/session-state/`

소요 시간: ~1분

---

## [2025-12-09 16:32] - Task 7: Integrate new features into src/index.ts

### DISCOVERED ISSUES
- None - integration task with well-defined API from previous tasks

### IMPLEMENTATION DECISIONS
- Added imports for new modules:
  - `loadUserAgents`, `loadProjectAgents` from `./features/claude-code-agent-loader`
  - `loadMcpConfigs` from `./features/claude-code-mcp-loader`
  - `setCurrentSession`, `setMainSession`, `getMainSessionID`, `getCurrentSessionTitle` from `./features/claude-code-session-state`
  - `log` from `./shared/logger`
- Removed local session variables (lines 77-79): `mainSessionID`, `currentSessionID`, `currentSessionTitle`
- Replaced direct session assignments with setter functions:
  - `mainSessionID = x` → `setMainSession(x)`
  - `currentSessionID = x; currentSessionTitle = y` → `setCurrentSession(x, y)`
- Replaced session variable reads with getter functions:
  - `mainSessionID` comparisons → `getMainSessionID()`
  - `currentSessionTitle` reads → `getCurrentSessionTitle()`
- Added agent loading in config hook: `loadUserAgents()`, `loadProjectAgents()`
- Added MCP loading in config hook: `await loadMcpConfigs()` (async)
- Replaced `console.error` with `log()` for config validation errors
- Renamed local variable `agents` to `builtinAgents` to distinguish from loaded agents

### PROBLEMS FOR NEXT TASKS
- Task 8 (README update) should document the new Agent Loader and MCP Loader features
- Should explain the `claude-code-*` naming convention

### VERIFICATION RESULTS
- Ran: `bun run typecheck` → exit 0, no errors
- Ran: `bun run build` → exit 0, successful build
- Session tracking verified: all event handlers use getter/setter functions
- Agent loading verified: config.agent merges builtin + user + project agents
- MCP loading verified: config.mcp merges builtin MCPs + loaded MCP servers

### LEARNINGS
- `setCurrentSession(id, title)` sets both ID and title atomically
- `loadMcpConfigs()` is async - must use `await` in config hook
- MCP result has `.servers` property that returns the server configs
- Order matters in spread: later values override earlier (projectAgents > userAgents > builtinAgents)

소요 시간: ~4분

---

## [2025-12-09 16:35] - Task 8: Update README.md documentation

### DISCOVERED ISSUES
- None - documentation update task

### IMPLEMENTATION DECISIONS
- Added Agent Loader feature documentation under "Other Features" section (line 235-238)
  - User scope: `~/.claude/agents/`
  - Project scope: `./.claude/agents/`
  - Format: `*.md` files with YAML frontmatter
- Added MCP Loader feature documentation (line 239-243)
  - User scope: `~/.claude/.mcp.json`
  - Project scope: `./.mcp.json`
  - Local scope: `./.claude/.mcp.json`
  - Environment variable expansion (`${VAR}` syntax)
- Added `claude-code-*` naming convention explanation as a blockquote note (line 245)
  - Explains features migrated from Claude Code
  - Lists examples: claude-code-command-loader, skill-loader, agent-loader, mcp-loader

### PROBLEMS FOR NEXT TASKS
- None - this is the final task

### VERIFICATION RESULTS
- README.md updated with new documentation
- Style matches existing documentation (bullet points, code blocks for paths)
- No sections removed or modified (only additions)

### LEARNINGS
- README.md "Other Features" section is at line 224
- Existing features: Terminal Title, Command Loader, Skill Loader
- Documentation style: bold feature name, bullet points for scopes/details

소요 시간: ~1분

---

## [2025-12-09 17:24] - Task 0: Shared Utilities 포팅

### DISCOVERED ISSUES
- command-executor.ts already existed but had minor whitespace differences (indentation inconsistency)
- pattern-matcher.ts and hook-disabled.ts import from `../claude-compat/types` which doesn't exist yet in oh-my-opencode
- Types will be created in Task 1 at `src/hooks/claude-code-hooks/types.ts`

### IMPLEMENTATION DECISIONS
- Created snake-case.ts and tool-name.ts (no dependencies) - exact copy from source
- Created temporary stub types at `src/hooks/claude-code-hooks/types.ts` with minimal definitions needed for shared utilities
- Created pattern-matcher.ts with adjusted import: `../claude-compat/types` → `../hooks/claude-code-hooks/types`
- Created hook-disabled.ts with adjusted import to point to stub types
- Added all new utilities to `src/shared/index.ts` using barrel export pattern
- Stub types include: HookCommand, HookMatcher, ClaudeHooksConfig, ClaudeHookEvent, PluginConfig

### PROBLEMS FOR NEXT TASKS
- Task 1 will replace stub types with full implementation from opencode-cc-plugin
- Stub types in `src/hooks/claude-code-hooks/types.ts` are marked with comments indicating they're temporary
- The real PluginConfig will likely be different - current stub only supports `disabledHooks` field

### VERIFICATION RESULTS
- Ran: `bun run typecheck` → exit 0, no errors
- All 5 functions exported: executeHookCommand, objectToSnakeCase, transformToolName, findMatchingHooks, isHookDisabled
- Import paths verified: pattern-matcher.ts and hook-disabled.ts successfully import from stub types

### LEARNINGS
- Import paths must be adjusted when porting between different project structures
- opencode-cc-plugin structure: `src/claude-compat/` → oh-my-opencode structure: `src/hooks/claude-code-hooks/`
- Stub types strategy allows Task 0 to complete and typecheck to pass before Task 1 implements full types
- command-executor.ts in oh-my-opencode had indentation inconsistency (not 100% identical to source)

소요 시간: ~5분

---

## [2025-12-09 17:34] - Task 1: types.ts 포팅

### DISCOVERED ISSUES
- Stub types.ts had `PluginConfig` interface needed by hook-disabled.ts (from Task 0)
- Full types.ts from opencode-cc-plugin did NOT have `PluginConfig`
- Typecheck initially failed: Module has no exported member 'PluginConfig'

### IMPLEMENTATION DECISIONS
- Copied full types.ts (181 lines) from opencode-cc-plugin → oh-my-opencode
- Preserved ALL types: ClaudeHooksConfig, HookMatcher, PreToolUseInput/Output, PostToolUseInput/Output
- Preserved deprecated decision fields: `decision?: "allow" | "deny" | "approve" | "block" | "ask"`
- Added `PluginConfig` interface at end (oh-my-opencode specific type needed by hook-disabled.ts)
- Kept line 150 comment (`// "pending" | "in_progress" | "completed"`) - existing source comment

### PROBLEMS FOR NEXT TASKS
- PluginConfig is now available for all subsequent tasks
- Full type definitions ready for Task 2, 3, 4+ to use

### VERIFICATION RESULTS
- Ran: `bun run typecheck` → exit 0, no errors
- Verified: ClaudeHooksConfig, HookMatcher, HookCommand types exist
- Verified: PreToolUseInput/Output, PostToolUseInput/Output types exist
- Verified: deprecated decision field (approve/block) included in PreToolUseOutput
- Verified: PluginConfig export added (fixes hook-disabled.ts import)

### LEARNINGS
- opencode-cc-plugin types.ts: 181 lines, no PluginConfig
- oh-my-opencode requires PluginConfig for hook disabling functionality
- Stub-to-full replacement pattern works: stub allows Task 0 typecheck, Task 1 replaces with full implementation
- Must preserve project-specific types (PluginConfig) when porting from different codebases

소요 시간: ~2분

---

## [2025-12-09 17:39] - Task 3: tool-input-cache.ts 포팅

### DISCOVERED ISSUES
- None - straightforward file copy task

### IMPLEMENTATION DECISIONS
- Copied tool-input-cache.ts (48 lines) from opencode-cc-plugin → oh-my-opencode
- Preserved cache structure:
  * Key format: `${sessionId}:${toolName}:${invocationId}`
  * TTL: 60000ms (1 minute) as CACHE_TTL constant
  * Periodic cleanup: setInterval every CACHE_TTL (60000ms)
- Preserved original comments from source file (lines 12, 39)
- Functions: cacheToolInput(), getToolInput()
- Cache behavior: getToolInput() deletes entry immediately after retrieval (single-use cache)

### PROBLEMS FOR NEXT TASKS
- Task 4 (pre-tool-use.ts) will call cacheToolInput() to store tool inputs
- Task 5 (post-tool-use.ts) will call getToolInput() to retrieve cached inputs for transcript building
- No import path changes needed - this file has no external dependencies

### VERIFICATION RESULTS
- File created: `src/hooks/claude-code-hooks/tool-input-cache.ts` (48 lines)
- Functions exported: cacheToolInput(), getToolInput()
- TTL verified: CACHE_TTL = 60000 (1 minute)
- Cleanup interval verified: setInterval(cleanup, CACHE_TTL)

### LEARNINGS
- Tool input cache is a temporary storage for PreToolUse → PostToolUse communication
- Single-use pattern: getToolInput() deletes entry after first retrieval (line 33)
- TTL check happens after deletion, so expired entries still return null
- setInterval runs in background for periodic cleanup of abandoned entries
- Source location: `~/local-workspaces/opencode-cc-plugin/src/claude-compat/hooks/tool-input-cache.ts`

소요 시간: ~2분

---

## [2025-12-09 17:39] - Task 2: config.ts + transcript.ts + todo.ts 포팅

### DISCOVERED ISSUES
- transcript.ts had unused imports (ClaudeCodeMessage, ClaudeCodeContent) - same as source file
- LSP warned about unused types - removed from import to clean up

### IMPLEMENTATION DECISIONS
- Copied config.ts (101 lines) - no import path changes needed (only uses `./types` and Node.js builtins)
- Copied transcript.ts (256 lines) - changed import path:
  * Line 10: `../shared/tool-name` → `../../shared/tool-name` (opencode-cc-plugin depth 1, oh-my-opencode depth 2)
- Copied todo.ts (78 lines) - no import path changes needed (only uses `./types` and Node.js builtins)
- Removed unused imports from transcript.ts: ClaudeCodeMessage, ClaudeCodeContent (not used in function bodies)
- Preserved ALL original comments from source files - these are pre-existing comments

### PROBLEMS FOR NEXT TASKS
- Task 3 will import cacheToolInput/getToolInput for cache functionality
- Task 4 will import loadClaudeHooksConfig, buildTranscriptFromSession
- Task 5 will import transcript building functions for PostToolUse hook

### VERIFICATION RESULTS
- Ran: `bun run typecheck` → exit 0, no errors
- Files created: config.ts (101 lines), transcript.ts (256 lines), todo.ts (78 lines)
- Functions available: loadClaudeHooksConfig(), buildTranscriptFromSession(), appendTranscriptEntry(), loadTodoFile(), saveTodoFile()
- Import paths verified: transcript.ts successfully imports transformToolName from ../../shared

### LEARNINGS
- Import path depth difference: opencode-cc-plugin `src/claude-compat/` (1 level up) → oh-my-opencode `src/hooks/claude-code-hooks/` (2 levels up)
- transcript.ts unused imports were present in original source - cleaning them is optional but improves code hygiene
- config.ts uses Bun.file() for async file reading - compatible with oh-my-opencode's Bun runtime
- Bun.file().text() automatically handles encoding

소요 시간: ~3분

---

