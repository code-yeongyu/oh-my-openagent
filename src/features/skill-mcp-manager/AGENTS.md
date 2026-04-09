# src/features/skill-mcp-manager/ — Skill-Embedded MCP Client Lifecycle

**Generated:** 2026-04-09

## OVERVIEW

18 files. Manages **tier 3** of the MCP system: skill-embedded MCP servers declared in SKILL.md YAML frontmatter. Per-session client isolation, dual transport (stdio + HTTP), OAuth 2.0 with step-up authentication, idle cleanup.

## THREE-TIER MCP CONTEXT

| Tier | Manager | Scope |
|------|---------|-------|
| 1. Built-in | `createBuiltinMcps()` (src/mcp/) | Global, 3 remote HTTP |
| 2. Claude Code | `claude-code-mcp-loader` (src/features/) | From `.mcp.json` |
| 3. **Skill-embedded** | **`SkillMcpManager` (this module)** | **Per-session, from SKILL.md YAML** |

## CLIENT KEY FORMAT

```
${sessionID}:${skillName}:${serverName}
```

Enables: per-session isolation, same skill usable in multiple sessions concurrently, multiple servers per skill.

## DUAL TRANSPORT

| Type | File | Backend |
|------|------|---------|
| **stdio** | `stdio-client.ts` | `StdioClientTransport` (local process) |
| **http** | `http-client.ts` | `StreamableHTTPClientTransport` (remote) |

**Detection** (connection-type.ts): explicit `type` field → URL presence → command presence. Legacy `"sse"` mapped to http.

## STATE

```typescript
interface SkillMcpManagerState {
  clients: Map<clientKey, ManagedClient>              // Active connections
  pendingConnections: Map<clientKey, Promise<Client>> // Race prevention
  disconnectedSessions: Map<sessionID, generation>    // Stale connection detection
  authProviders: Map<url, OAuthProvider>              // OAuth state per server
  inFlightConnections: Map<sessionID, count>          // Connection counting
}
```

## KEY FILES

| File | Purpose |
|------|---------|
| `manager.ts` | `SkillMcpManager` class — main API (getOrCreateClient, disconnectSession, listTools, callTool, etc.) |
| `types.ts` | `ManagedStdioClient`, `ManagedHttpClient`, `SkillMcpManagerState`, `ConnectionType` |
| `connection.ts` | Client factory with race prevention, retry, env var expansion |
| `connection-type.ts` | Detect stdio vs http from config (legacy sse → http) |
| `stdio-client.ts` | Stdio transport factory |
| `http-client.ts` | HTTP transport factory |
| `cleanup.ts` | SIGINT/SIGTERM handlers, idle timer (60s interval, 5min TTL) |
| `oauth-handler.ts` | OAuth token management, refresh, step-up (403 scope escalation) |
| `env-cleaner.ts` | Filter npm/pnpm/yarn config + 25+ secret patterns (_KEY, _SECRET, _TOKEN) |
| `error-redaction.ts` | Redact sensitive data from error messages before logging |

## LIFECYCLE INTEGRATION

**Hook**: `src/plugin/event.ts` on `session.deleted`:
```typescript
await managers.skillMcpManager.disconnectSession(sessionInfo.id)
```

## LIFECYCLE FLOW

```
1. session.created      → No action (lazy connection)
2. First MCP tool call  → getOrCreateClient() creates + caches
3. Ongoing use          → lastUsedAt timestamp updated
4. Idle >5min           → cleanup timer removes
5. session.deleted      → disconnectSession() closes session clients
6. Process exit         → disconnectAll() via SIGINT/SIGTERM handlers
```

## RACE CONDITION PREVENTION

- **pendingConnections**: Deduplicates concurrent connection attempts for same key
- **inFlightConnections**: Per-session counter, prevents premature cleanup during connection setup
- **shutdownGeneration**: Counter-based stale connection detection after disconnect

## PUBLIC API

```typescript
class SkillMcpManager {
  constructor(options?: { createOAuthProvider? })
  getOrCreateClient(info, config): Promise<Client>
  disconnectSession(sessionID): Promise<void>
  disconnectAll(): Promise<void>
  listTools/Resources/Prompts(info, context): Promise<...[]>
  callTool(info, context, name, args): Promise<unknown>
  readResource(info, context, uri): Promise<unknown>
  getPrompt(info, context, name, args): Promise<unknown>
  getConnectedServers(): string[]
  isConnected(info): boolean
}
```

## RETRY SEMANTICS

- `getOrCreateClientWithRetry()` — 3 attempts with force reconnect on failure
- `withOperationRetry()` — OAuth-aware wrapper: step-up on 403, token refresh on 401

## SECURITY

- **env-cleaner.ts** — strips npm/pnpm config vars (prevents pnpm project isolation issues) and secret patterns before stdio spawn
- **error-redaction.ts** — masks tokens/secrets in error messages before logger.log
- **OAuth isolation** — auth providers keyed by server URL, tokens never cross servers
