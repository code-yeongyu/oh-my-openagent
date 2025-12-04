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

