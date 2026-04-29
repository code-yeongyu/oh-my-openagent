# src/plugin-handlers/ — 6-Phase Config Loading Pipeline

**Generated:** 2026-04-18

## CRITICAL: AGENT ORDERING

The canonical agent order is **sisyphus → hephaestus → prometheus → atlas**.

This order is enforced via two cooperating mechanisms:
1. `CANONICAL_CORE_AGENT_ORDER` in `agent-priority-order.ts` controls object key insertion order in the agent map produced by `applyAgentConfig`.
2. `installAgentSortShim()` in `src/shared/agent-sort-shim.ts` narrows `Array.prototype.toSorted` and `Array.prototype.sort` so that whenever the sorted array contains two or more agent objects whose `.name` matches a canonical core display name, OpenCode's `Agent.list()` (and any other sort site) returns the canonical order. The shim is installed once at plugin entry, before any agent registration.

### Why a Sort Shim

OpenCode 1.4.x sorts agents purely by `agent.name` via Remeda `sortBy`, which uses native string `<` / `>` comparison (NOT `localeCompare`). It currently ignores the agent `order` field. Until that lands (sst/opencode#19127), object-key insertion order alone does not survive `Agent.list()`, and biasing the sort key with invisible characters all failed:
- ZWSP (U+200B): `Bun.stringWidth` returns 0 but terminals (Ghostty, WezTerm, Alacritty, certain Windows Terminal builds) render it as 1-cell wide. Visible gap in the status bar; column truncation in the agent picker (#3259).
- U+2060 WORD JOINER, U+00AD SOFT HYPHEN, ANSI escape: same width-mismatch class.
- Removing the prefix and relying on insertion order alone falls back to alphabetical Atlas → Hephaestus → Prometheus → Sisyphus.

The sort shim resolves this by intercepting only the narrow case it cares about, with strict activation guards to prevent collateral damage from a global prototype patch:
- The activation predicate (`isAgentArray`) requires `arr.length >= 2`, every element is a non-null object with a string `.name`, and at least 2 elements have a `.name` matching one of the four canonical core display names. This rejects mixed-type arrays (numbers, strings, plain objects without `.name`) so unrelated `.sort()` / `.toSorted()` calls execute native semantics.
- The comparator never throws on mixed input — it defensively extracts `.name` and falls back to the user-supplied `compareFn`.
- `installAgentSortShim()` is idempotent.

### History

Agent ordering has caused 15+ commits, 8+ PRs, and multiple reverts. Notable milestones:
- #3260 (merged): removed ZWSP injection. Reverted by `0d5b08744` because OpenCode 1.4.x ignores `order`, and removal alone causes alphabetical fallback (Atlas → Hephaestus → Prometheus → Sisyphus).
- #3329 (merged): introduced `CANONICAL_CORE_AGENT_ORDER` and locked the policy. Insertion order alone still does not survive OpenCode's `Agent.list()` sort.
- #3267 (closed): proposed a sort shim. Closed at the time on the assumption that #3329 was sufficient. Revived in this commit with cubic P1 mitigations (defensive comparator, strict activation predicate, idempotent install).

### Forbidden Patterns

DO NOT introduce:
- ZWSP, U+2060, U+00AD, ANSI escape, or any other invisible / control character in agent names, display names, or object keys.
- ASCII spaces or other visible sort prefixes on agent names.
- Alternative ordering constants outside `CANONICAL_CORE_AGENT_ORDER`.
- Object.entries() iteration-order dependencies.
- Agent name string comparisons that skip `getAgentConfigKey` / `stripInvisibleAgentCharacters` (legacy ZWSP-baked data must keep resolving).

The sort shim in `src/shared/agent-sort-shim.ts` is the ONLY supported runtime ordering mechanism. Remove it once OpenCode honors the agent `order` field (sst/opencode#19127).

PRs attempting any of the forbidden patterns will be rejected.

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
