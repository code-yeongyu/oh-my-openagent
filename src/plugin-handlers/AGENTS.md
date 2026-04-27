# src/plugin-handlers/ — 6-Phase Config Loading Pipeline

**Generated:** 2026-04-18

## CRITICAL: AGENT ORDERING

The canonical agent order is **sisyphus → hephaestus → prometheus → atlas**.

This order is enforced via two mechanisms working together:
1. `CANONICAL_CORE_AGENT_ORDER` in `agent-priority-order.ts` controls object key insertion order
2. `agent-key-remapper.ts` injects leading-space-prefixed runtime names into the `name` field for OpenCode's `localeCompare` sort

### Why Two Mechanisms

OpenCode's `Agent.list()` sorts agents by `name` field via `localeCompare`. Object key order alone is not enough. The `name` field carries leading ASCII spaces (4-3-2-1 descending) so core agents sort before alphabetically-named agents.

The prefix lengths are intentionally **descending** (sisyphus=4, hephaestus=3, prometheus=2, atlas=1) because `localeCompare` puts strings with more leading whitespace before strings with fewer. Reference: see `agent-runtime-name-sort.test.ts` for empirical verification.

### Why ASCII Spaces, Not ZWSP

Earlier versions used ZWSP (`\u200B`) prefixes hoping they would be invisible to users. They silently failed: Unicode collation algorithms treat zero-width characters as ignorable at the primary level, so ZWSP-prefixed names sorted as if the prefix did not exist. The result was alphabetical order interleaving core and non-core agents.

ASCII space (`\u0020`) is the only character that:
- Sorts before alphabetic characters reliably under all locales
- Renders correctly in every terminal (no glyph substitution)
- Is valid in HTTP header values (RFC 7230) when placed in the `name` field

The leading-space prefix MUST NOT appear in:
- Object keys (used as HTTP header values, causes RFC 7230 violations)
- Display names returned by `getAgentDisplayName()`
- Config keys

### Backward Compatibility

`stripAgentListSortPrefix()` strips both the new leading-space prefix AND legacy ZWSP/zero-width characters. Existing sessions and configs from the ZWSP era continue to resolve correctly.

### History

Agent ordering caused 15+ commits, 8+ PRs, and multiple reverts due to:
1. Early ZWSP attempts that leaked into HTTP headers via object keys
2. Object.entries() iteration order depending on merge sequence
3. Multiple code paths assembling agents differently
4. The ZWSP prefix being silently broken in `localeCompare` sort (resolved in this commit by switching to leading ASCII spaces)

### Forbidden Patterns

DO NOT introduce:
- ZWSP in any field (broken in `localeCompare`, replaced by leading ASCII spaces)
- Leading whitespace in object keys or display names (allowed only in `name` field via `getAgentRuntimeName()`)
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
