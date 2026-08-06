# agents-md-core — AGENTS.md Discovery + Injection (Core)

**Generated:** 2026-06-17

## OVERVIEW

Harness-neutral logic for walking a file path UP its directory tree, discovering nearby `AGENTS.md` files, truncating their content, and formatting them as a `[Directory Context: ...]` block for injection into the session. Discovery itself is delegated to [`rules-engine`](../rules-engine/AGENTS.md) (`findAgentsMdUp`, `AgentsMdCache`); this package owns path resolution, formatting, and the per-session injected-paths cache. Package: `@oh-my-opencode/agents-md-core`.

## PUBLIC API (`src/index.ts`)

| Export | Source | Role |
|--------|--------|------|
| `AGENTS_FILENAME` | `constants.ts` | re-exported from `rules-engine` (value `"AGENTS.md"`) |
| `resolveFilePath(rootDir, path)` | `finder.ts` | resolve + `realpathSync` validate path is inside `rootDir`; `null` if escapes |
| `formatAgentsMdContextBlock({agentsPath, content, truncated})` | `formatter.ts` | wrap content in directory-context block + optional truncation notice |
| `getSessionCache({sessionCaches, sessionID, storage})` | `injection-cache.ts` | per-session `Set<string>` of already-injected dirs, backed by storage |
| `processFilePathForAgentsInjection(...)` | `injector.ts` | orchestrator: resolve → `findAgentsMdUp` → read → truncate → format → cache |
| types | `types.ts` | `AgentsMdTruncator`, `AgentsMdContextOutput`, `AgentsMdInjectedPathsStorage`, `TruncationResult` |

## DEPENDENCIES & CONSUMERS

- **Depends on:** `@oh-my-opencode/rules-engine` only.
- **Consumed by** (OpenCode edition only; no Codex consumer): `omo-opencode/src/hooks/directory-agents-injector/{finder,injector}.ts` (re-export) and `hooks/hephaestus-agents-md-injector/hook.ts` (`formatAgentsMdContextBlock`).

## NOTES

- **Path-traversal guard is a security invariant.** `resolveFilePath` canonicalizes via `realpathSync` and returns `null` when the resolved path is outside `rootDirectory`.
- **Truncator + storage are injected** (`AgentsMdTruncator`, `AgentsMdInjectedPathsStorage`) — this package never implements truncation strategy or persistence itself.
- Parent: [`packages/AGENTS.md`](../AGENTS.md).
