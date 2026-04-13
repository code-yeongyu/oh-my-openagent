# src/plugin-handlers/ — 6-Phase Config Loading Pipeline

**Generated:** 2026-04-11

## CRITICAL: AGENT ORDERING

The canonical agent order is **sisyphus → hephaestus → prometheus → atlas**.

This order is enforced via two mechanisms working together:
1. `CANONICAL_CORE_AGENT_ORDER` in `agent-priority-order.ts` controls object key insertion order
2. `agent-priority-order.ts` injects an explicit `order` field (1-4) into each core agent config

### How Ordering Works

`reorderAgentsByPriority` iterates over `CANONICAL_CORE_AGENT_ORDER`, matches each core agent by
display name, and inserts it first into the result object. JavaScript preserves string-key insertion
order (ES2015+), so core agents always appear before custom agents regardless of alphabetical order.

The `order` field (integers 1-4) is stored as metadata this repo can provide — **this repo only
stores it**; whether OpenCode consumes it for rendering is outside this codebase's control.

ZWSP (U+200B) MUST NOT appear anywhere in the agent config — not in:
- Object keys (used as HTTP header values, causes RFC 7230 violations)
- Display names returned by `getAgentDisplayName()`
- Config keys
- The `name` field (OpenCode passes `name` as the `mode_type` HTTP header — ZWSP causes TypeError)

### History

Agent ordering has caused 15+ commits, 8+ PRs, and multiple reverts due to:
1. Early ZWSP attempts that leaked into HTTP headers via object keys
2. Object.entries() iteration order depending on merge sequence
3. Multiple code paths assembling agents differently
4. ZWSP in the `name` field leaking into the `mode_type` HTTP header

### Forbidden Patterns

DO NOT introduce:
- ZWSP anywhere in agent configs (keys, display names, or `name` field)
- Runtime sort shims or comparators
- Alternative ordering constants
- Object.entries() order dependencies

PRs attempting these patterns will be rejected.

## OVERVIEW

14 non-test files implementing the `ConfigHandler` — the `config` hook handler. Executes 6 sequential phases to register agents, tools, MCPs, and commands with OpenCode.

## 6-PHASE PIPELINE

| Phase | Handler | Purpose |
|-------|---------|---------|
| 1 | `applyProviderConfig` | Cache model context limits, detect anthropic-beta headers |
| 2 | `loadPluginComponents` | Discover Claude Code plugins (10s timeout, error isolation) |
| 3 | `applyAgentConfig` | Load agents from 5 sources, skill discovery, plan demotion |
| 4 | `applyToolConfig` | Agent-specific tool permissions |
| 5 | `applyMcpConfig` | Merge builtin + CC + plugin MCPs |
| 6 | `applyCommandConfig` | Merge commands/skills from 9 parallel sources |

## FILES

| File | Lines | Purpose |
|------|-------|---------|
| `config-handler.ts` | ~200 | Main orchestrator, 6-phase sequential |
| `plugin-components-loader.ts` | ~100 | CC plugin discovery (10s timeout) |
| `agent-config-handler.ts` | ~300 | Agent loading + skill discovery from 5 sources |
| `mcp-config-handler.ts` | ~150 | Builtin + CC + plugin MCP merge |
| `command-config-handler.ts` | ~200 | 9 parallel sources for commands/skills |
| `tool-config-handler.ts` | ~100 | Agent-specific tool grants/denials |
| `provider-config-handler.ts` | ~80 | Provider config + model cache |
| `prometheus-agent-config-builder.ts` | ~100 | Prometheus config with model resolution |
| `plan-model-inheritance.ts` | 28 | Plan demotion logic |
| `agent-priority-order.ts` | ~30 | sisyphus, hephaestus, prometheus, atlas first |
| `agent-key-remapper.ts` | ~30 | Agent key → display name |
| `category-config-resolver.ts` | ~40 | User vs default category lookup |
| `index.ts` | ~10 | Barrel exports |

## TOOL PERMISSIONS

| Agent | Granted | Denied |
|-------|---------|--------|
| Librarian | grep_app_* | — |
| Atlas, Sisyphus, Prometheus | task, task_*, teammate | — |
| Hephaestus | task | — |
| Default (all others) | — | grep_app_*, task_*, teammate, LSP |

## MULTI-LEVEL CONFIG MERGE

```
User (~/.config/opencode/oh-my-opencode.jsonc)
  ↓ deepMerge
Project (.opencode/oh-my-opencode.jsonc)
  ↓ Zod defaults
Final Config
```

- `agents`, `categories`, `claude_code`: deep merged
- `disabled_*` arrays: Set union
