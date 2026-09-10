# src/plugin-handlers/ -- Sequential Config Loading Pipeline

**Generated:** 2026-07-17 / 7d664b96b

## CRITICAL: AGENT ORDERING

The default agent order is **sisyphus → hephaestus → prometheus → atlas**. User config may override it with `agent_order`; omitted core agents fall back to this default order.

This order is enforced via three cooperating mechanisms:
1. `DEFAULT_AGENT_ORDER` in `src/shared/agent-ordering.ts` supplies the fallback order used when `agent_order` is absent or incomplete.
2. `reorderAgentsByPriority()` in `agent-priority-order.ts` controls object key insertion order in the agent map produced by `applyAgentConfig`.
3. `installAgentSortShim()` in `src/shared/agent-sort-shim.ts` narrows `Array.prototype.toSorted` and `Array.prototype.sort` so that whenever the sorted array contains two or more ranked agent objects, OpenCode's `Agent.list()` (and any other sort site) returns the active configured/default order. The shim is installed once at plugin entry, before any agent registration, and its rank map is updated after plugin config loads.

### Why a Sort Shim

OpenCode 1.4.x sorts agents purely by `agent.name` via Remeda `sortBy`, which uses native string `<` / `>` comparison (NOT `localeCompare`). It currently ignores the agent `order` field. Until that lands (sst/opencode#19127), object-key insertion order alone does not survive `Agent.list()`, and biasing the sort key with invisible characters all failed:
- ZWSP (U+200B): `Bun.stringWidth` returns 0 but terminals (Ghostty, WezTerm, Alacritty, certain Windows Terminal builds) render it 1-cell wide -- visible status-bar gap, agent-picker truncation (#3259). U+2060, U+00AD, and ANSI escapes are the same width-mismatch class.
- Removing the prefix and relying on insertion order alone falls back to alphabetical Atlas → Hephaestus → Prometheus → Sisyphus.

The sort shim resolves this by intercepting only the narrow case it cares about, with strict activation guards to prevent collateral damage from a global prototype patch:
- The activation predicate (`isAgentArray`) requires `arr.length >= 2`, every element is a non-null object with a string `.name`, and at least 2 elements have a `.name` ranked by the active order. This rejects mixed-type arrays (numbers, strings, plain objects without `.name`) so unrelated `.sort()` / `.toSorted()` calls execute native semantics.
- The comparator never throws on mixed input -- it defensively extracts `.name` and falls back to the user-supplied `compareFn`.
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
- Alternative ordering constants outside `DEFAULT_AGENT_ORDER` / `CANONICAL_CORE_AGENT_ORDER`, or ordering code that bypasses `validateAgentOrder`.
- Object.entries() iteration-order dependencies.
- Agent name string comparisons that skip `getAgentConfigKey` / `stripInvisibleAgentCharacters` (legacy ZWSP-baked data must keep resolving).

The sort shim in `src/shared/agent-sort-shim.ts` is the ONLY supported runtime ordering mechanism. Remove it once OpenCode honors the agent `order` field (sst/opencode#19127). PRs attempting any forbidden pattern are rejected.

## OVERVIEW

20 non-test files implementing the `ConfigHandler` -- the `config` hook handler. Phases run sequentially to register agents, tools, MCPs, and commands with OpenCode. `createConfigHandler` caches the agent phase behind a config cache key and replays its side effects when the key is unchanged.

## PHASE ORDER

| Phase | Handler | Purpose |
|-------|---------|---------|
| 1 | `applyProviderConfig` | Model context limits, anthropic-beta headers (formatter cache cleared here) |
| 2 | `loadPluginComponents` | Discover Claude Code plugins (10s timeout, error isolation) |
| 3 | `applyHookConfig` | Register plugin-supplied hooks before agents load |
| 4 | `applyAgentConfig` | Load agents from 5 sources, skill discovery, plan demotion (snapshot-cached) |
| 5 | `applyToolConfig` | Agent-specific tool permissions |
| 6 | `applyMcpConfig` | Merge builtin + CC + plugin MCPs |
| 7 | `applyCommandConfig` | Merge commands/skills from 9 parallel sources |
| 8 | `applyRuntimeSkillSourceConfig` | Register the runtime skill source when a URL is supplied |

## FILES

| File | Purpose |
|------|---------|
| `config-handler.ts` | Main orchestrator; phase sequencing plus agent snapshot cache |
| `plugin-components-loader.ts` | CC plugin discovery (10s timeout) |
| `agent-config-handler.ts` + `agent-source-loader.ts` / `agent-config-assembly.ts` / `agent-config-finalizer.ts` / `agent-config-types.ts` | Agent phase: source loading, assembly, finalization (display-name remap + ordering) |
| `agent-skill-discovery.ts`, `agent-override-protection.ts` | Skill discovery for agents; guard user overrides |
| `hook-config-handler.ts` | Register plugin-supplied hooks |
| `mcp-config-handler.ts` / `command-config-handler.ts` | Builtin + CC + plugin MCP merge; 9 parallel command/skill sources |
| `tool-config-handler.ts` / `provider-config-handler.ts` | Agent tool grants/denials; provider config + model cache |
| `prometheus-agent-config-builder.ts` | Prometheus config with model + fallback_models resolution |
| `plan-model-inheritance.ts` | Plan demotion logic (inherits model settings incl. fallback_models) |
| `agent-priority-order.ts` | sisyphus, hephaestus, prometheus, atlas first |
| `agent-key-remapper.ts` | Agent key → display name |
| `category-config-resolver.ts` | User vs default category lookup |
| `index.ts` | Barrel exports |

## TOOL PERMISSIONS

| Agent | Granted | Denied |
|-------|---------|--------|
| Librarian | grep_app_* | task |
| Atlas, Sisyphus, Prometheus | task, task_*, teammate | call_omo_agent (Prometheus also bash + interactive_bash) |
| Hephaestus | task, teammate | call_omo_agent |
| Sisyphus-junior | task_*, teammate | - |
| explore, oracle, multimodal-looker, metis, momus | - | task (looker also look_at) |
| Default (all others) | - | grep_app_*, task_*, teammate, LspHover/LspCodeActions/LspCodeActionResolve |

Task system enabled -> `todowrite`/`todoread` off; `question` denies under CLI run mode, host `permission.question: deny`, or `disabled_tools`.

## MULTI-LEVEL CONFIG MERGE

User `~/.omo/omo.jsonc` -> deepMerge -> project `.omo/omo.jsonc` -> Zod defaults -> final config.

- `agents`, `categories`, `claude_code`: deep merged
- `disabled_*` arrays: Set union
