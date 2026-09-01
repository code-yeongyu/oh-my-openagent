# mcp-client-core — MCP Client + Skill-Embedded MCP (Core)

**Generated:** 2026-08-24 / f3642fcda

## OVERVIEW

Harness-neutral MCP client lifecycle and OAuth primitives. Consumed by `omo-opencode` via `features/skill-mcp-manager` and `features/mcp-oauth` / `cli/mcp-oauth`. Private package `@oh-my-opencode/mcp-client-core`; 30 source files under `src/`.

## KEY FILES

| File | Role |
|------|------|
| `skill-mcp-manager/manager.ts` | `SkillMcpManager` — per-session client registry, listTools/callTool/readResource/getPrompt, retry loop with OAuth step-up |
| `skill-mcp-manager/connection.ts` | `getOrCreateClient()` / `getOrCreateClientWithRetryImpl()` — race-safe connection, dispatch to stdio or HTTP |
| `skill-mcp-manager/connection-type.ts` | Connection-type inference: explicit `type` field > `url` presence > `command` presence |
| `skill-mcp-manager/env-cleaner.ts` | Filters npm/pnpm/yarn config vars (pnpm breakage) and secret-bearing env vars from stdio server env |
| `skill-mcp-manager/error-redaction.ts` | Redacts sensitive tokens from error messages (same patterns as env-cleaner) |
| `skill-mcp-manager/stdio-client.ts` | `createStdioClient()` — `StdioClientTransport`, env cleaning, process cleanup registration |
| `skill-mcp-manager/http-client.ts` | `createHttpClient()` — `StreamableHTTPClientTransport`, request init with OAuth headers, URL redaction |
| `skill-mcp-manager/oauth-handler.ts` | `buildHttpRequestInit()`, `handleStepUpIfNeeded()`, `handlePostRequestAuthError()` — token refresh, scope merge, 401/403 retry |
| `skill-mcp-manager/cleanup.ts` | `disconnectSession()`, `disconnectAll()`, `forceReconnect()`, idle timeout (5 min), SIGTERM/SIGINT handlers |
| `skill-mcp-manager/types.ts` | `SkillMcpClientInfo`, `ManagedClient`, `ConnectionType`, `SkillMcpManagerState` |
| `mcp-oauth/provider.ts` | `McpOAuthProvider` — login (DCR + PKCE redirect), refresh, token storage |
| `mcp-oauth/oauth-authorization-flow.ts` | PKCE verifier/challenge, browser open, 5-min timeout |
| `mcp-oauth/discovery.ts` | `discoverOAuthServerMetadata()` — `.well-known/oauth-protected-resource` + `oauth-authorization-server` with cache |
| `mcp-oauth/dcr.ts` | `getOrRegisterClient()` — Dynamic Client Registration, fallback to static clientId |
| `mcp-oauth/step-up.ts` | `isStepUpRequired()`, `mergeScopes()`, `parseWwwAuthenticate()` — 403 scope escalation |
| `mcp-oauth/refresh-mutex.ts` | Per-server refresh mutex: one in-flight refresh, all waiters share the result |
| `mcp-oauth/resource-indicator.ts` | `getResourceIndicator()` — normalized URL (query/hash/trailing-slash stripped) as OAuth resource indicator |
| `mcp-oauth/schema.ts` | Zod `McpOauthSchema` (`clientId`, `scopes`) |
| `mcp-oauth/storage-index.ts` | `index.json` server-URL → token-file index; atomic rename + chmod writes |
| `mcp-oauth/callback-server.ts` | `findAvailablePort()`, `startCallbackServer()` for local OAuth callback |
| `mcp-oauth/storage.ts` | `loadToken()` / `saveToken()` — keyed by server URL |
| `config-dir.ts` / `plugin-identity.ts` / `logger.ts` | realpath-normalized config path resolution; `PLUGIN_NAME` ("oh-my-openagent"); shared logger |
| `index.ts` | Barrel: re-exports `mcp-oauth/*` and `skill-mcp-manager/*` |

## NOTES

- **Per-session isolation:** client key is `${sessionID}:${skillName}:${serverName}`. The same skill in two sessions does not share state.
- **Transports:** stdio (local process via `StdioClientTransport`) and HTTP (remote via `StreamableHTTPClientTransport`). Connection type inferred from `url` vs `command`, or explicit `type` field.
- **OAuth flow:** PKCE + optional DCR. Step-up authentication on 403 merges new scopes and re-authenticates. Refresh mutex prevents concurrent refresh storms.
- **Env hygiene is a security boundary:** stdio servers never receive npm/pnpm/yarn config vars or secret-bearing env vars (`env-cleaner.ts`); errors leaving the manager are token-redacted (`error-redaction.ts`). Preserve both when touching client construction or error paths.
- **Cleanup:** idle clients evicted after 5 minutes. Process signal handlers close all transports on SIGINT/SIGTERM. `disconnectAll()` is safe across plugin reloads.
- **Consumers:** `packages/omo-opencode/src/features/skill-mcp-manager/`, `packages/omo-opencode/src/features/mcp-oauth/`, and `packages/omo-opencode/src/cli/mcp-oauth/` import this Core package.

Parent: [`packages/AGENTS.md`](../AGENTS.md)
