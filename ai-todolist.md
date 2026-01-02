# Full MCP Spec Support Implementation Plan

> **Goal**: Extend skill-mcp feature to support full MCP spec including remote OAuth, HTTP/SSE transports, and token management.
> **Branch**: `skill-mcp-full-spec-support`
> **Created**: 2026-01-02

## Summary

The current skill-mcp implementation only supports `StdioClientTransport` for local MCP servers. This plan adds:
- StreamableHTTPClientTransport for remote servers
- SSEClientTransport as fallback
- OAuth 2.0 authentication with PKCE
- Persistent token storage
- Dynamic client registration
- Server status tracking

## Phase 1: Foundation Types & Storage (Tasks 1-8)

### Task 1: Create OAuth Types File
**File:** `src/features/skill-mcp-manager/oauth/types.ts`
**Action:** CREATE
**Description:** Define OAuth-specific types for MCP authentication

**What to do:**
- Define `McpOAuthTokens` interface matching MCP SDK's `OAuthTokens`
- Define `McpOAuthClientInfo` interface for dynamic client registration
- Define `McpOAuthCredentials` interface for storage format
- Define `McpCodeVerifierData` for PKCE state
- Define `OAuthStorageKeys` type for storage key patterns

**What NOT to do:**
- Don't copy antigravity types verbatim - adapt for MCP SDK patterns
- Don't add provider-specific fields (Google, GitHub, etc.)

**Acceptance Criteria:**
- [ ] Types compile without errors
- [ ] Types align with @modelcontextprotocol/sdk/shared/auth types

---

### Task 2: Write OAuth Storage Tests (TDD)
**File:** `src/features/skill-mcp-manager/oauth/storage.test.ts`
**Action:** CREATE
**Description:** Test-first development for token storage

**What to do:**
- Test `loadTokens(serverUrl)` returns undefined when no tokens
- Test `saveTokens(serverUrl, tokens)` persists tokens
- Test `loadTokens(serverUrl)` returns saved tokens
- Test `loadClientInfo(serverUrl)` returns undefined initially
- Test `saveClientInfo(serverUrl, info)` persists client info
- Test `saveCodeVerifier(serverUrl, verifier)` persists verifier
- Test `loadCodeVerifier(serverUrl)` returns saved verifier
- Test `clearCredentials(serverUrl)` removes all data for server

**What NOT to do:**
- Don't test actual file I/O - mock Bun.file

**Acceptance Criteria:**
- [ ] Tests run but fail (no implementation yet)
- [ ] Tests use #given, #when, #then comments

---

### Task 3: Implement OAuth Storage
**File:** `src/features/skill-mcp-manager/oauth/storage.ts`
**Action:** CREATE
**Description:** Persistent storage for OAuth credentials

**What to do:**
- Import `getDataDir` from shared
- Create storage path: `{dataDir}/opencode/storage/skill-mcp-oauth/`
- Implement `getStoragePath(serverUrl)` - hash URL for filename
- Implement `loadTokens(serverUrl): McpOAuthTokens | undefined`
- Implement `saveTokens(serverUrl, tokens): void`
- Implement `loadClientInfo(serverUrl): McpOAuthClientInfo | undefined`
- Implement `saveClientInfo(serverUrl, info): void`
- Implement `saveCodeVerifier(serverUrl, verifier): void`
- Implement `loadCodeVerifier(serverUrl): string | undefined`
- Implement `clearCredentials(serverUrl): void`

**What NOT to do:**
- Don't use synchronous file operations
- Don't store tokens in memory only (must persist)

**Acceptance Criteria:**
- [ ] All Task 2 tests pass
- [ ] Uses Bun.write/Bun.file for async file ops
- [ ] Handles missing directory gracefully

---

### Task 4: Extend ClaudeCodeMcpServer Type
**File:** `src/features/claude-code-mcp-loader/types.ts`
**Action:** MODIFY
**Description:** Add oauth field to server config type

**What to do:**
- Add `oauth?: boolean | McpOAuthConfig` field to `ClaudeCodeMcpServer`
- Define `McpOAuthConfig` interface:
  ```typescript
  interface McpOAuthConfig {
    clientId?: string
    clientSecret?: string
    scope?: string
  }
  ```

**What NOT to do:**
- Don't remove existing fields
- Don't make oauth required

**Acceptance Criteria:**
- [ ] Type compiles
- [ ] Existing code using ClaudeCodeMcpServer continues to work

---

### Task 5: Add Status Types
**File:** `src/features/skill-mcp-manager/types.ts`
**Action:** MODIFY
**Description:** Add MCP server status tracking types

**What to do:**
- Define `McpServerStatus` type:
  ```typescript
  type McpServerStatus = 
    | "connected"
    | "disabled"
    | "failed"
    | "needs_auth"
    | "needs_client_registration"
  ```
- Add `status?: McpServerStatus` to `SkillMcpServerContext`
- Add `statusMessage?: string` for error details

**What NOT to do:**
- Don't break existing type exports

**Acceptance Criteria:**
- [ ] Types compile
- [ ] Existing code works unchanged

---

### Task 6: Create OAuth Module Barrel Export
**File:** `src/features/skill-mcp-manager/oauth/index.ts`
**Action:** CREATE
**Description:** Barrel export for OAuth submodule

**What to do:**
- Export all types from `./types`
- Export storage functions from `./storage`
- Export provider class from `./provider` (placeholder for now)
- Export callback functions from `./callback` (placeholder for now)

**What NOT to do:**
- Don't export internal implementation details

**Acceptance Criteria:**
- [ ] `import { ... } from "./oauth"` works from parent

---

### Task 7: Update skill-mcp-manager Index
**File:** `src/features/skill-mcp-manager/index.ts`
**Action:** MODIFY
**Description:** Export OAuth module

**What to do:**
- Add `export * from "./oauth"`
- Keep existing exports

**What NOT to do:**
- Don't change existing export structure

**Acceptance Criteria:**
- [ ] All existing imports continue to work
- [ ] OAuth exports available

---

### Task 8: Verify Phase 1 Completion
**Action:** RUN
**Command:** `bun test src/features/skill-mcp-manager/oauth/`

**Acceptance Criteria:**
- [ ] All storage tests pass
- [ ] TypeScript compiles without errors: `bun run typecheck`

---

## Phase 2: OAuth Provider Implementation (Tasks 9-16)

### Task 9: Write OAuth Callback Server Tests (TDD)
**File:** `src/features/skill-mcp-manager/oauth/callback.test.ts`
**Action:** CREATE
**Description:** Test-first for OAuth callback server

**What to do:**
- Test `startCallbackServer()` returns server handle
- Test callback server has dynamic port
- Test `waitForCallback()` returns code on success
- Test `waitForCallback()` returns error on failure
- Test `close()` stops server
- Test timeout triggers rejection

**What NOT to do:**
- Don't make actual HTTP requests in tests - mock Bun.serve

**Acceptance Criteria:**
- [ ] Tests use #given, #when, #then
- [ ] Tests run but fail (no implementation)

---

### Task 10: Implement OAuth Callback Server
**File:** `src/features/skill-mcp-manager/oauth/callback.ts`
**Action:** CREATE
**Description:** HTTP server for OAuth callback

**What to do:**
- Define `CallbackServerHandle` interface:
  ```typescript
  interface CallbackServerHandle {
    port: number
    waitForCallback(): Promise<CallbackResult>
    close(): void
  }
  ```
- Implement `startCallbackServer(timeoutMs?: number): CallbackServerHandle`
- Use `Bun.serve` with `port: 0` for dynamic port
- Handle `/oauth-callback` route
- Extract `code` and `state` from query params
- Return HTML success/error page
- Implement timeout rejection

**Reference:** `src/auth/antigravity/oauth.ts` lines 243-317

**What NOT to do:**
- Don't hardcode port number
- Don't block main thread

**Acceptance Criteria:**
- [ ] Task 9 tests pass
- [ ] Server starts and stops cleanly

---

### Task 11: Write OAuth Provider Tests (TDD)
**File:** `src/features/skill-mcp-manager/oauth/provider.test.ts`
**Action:** CREATE
**Description:** Test OAuthClientProvider implementation

**What to do:**
- Test `redirectUrl` getter returns configured URL
- Test `clientMetadata` getter returns metadata
- Test `clientInformation()` returns undefined initially
- Test `saveClientInformation(info)` stores info
- Test `clientInformation()` returns saved info
- Test `tokens()` returns undefined initially
- Test `saveTokens(tokens)` stores tokens
- Test `tokens()` returns saved tokens
- Test `codeVerifier()` throws when not set
- Test `saveCodeVerifier(v)` then `codeVerifier()` returns it
- Test `redirectToAuthorization(url)` calls onRedirect callback

**What NOT to do:**
- Don't test actual browser opening

**Acceptance Criteria:**
- [ ] Tests use #given, #when, #then
- [ ] Tests run but fail (no implementation)

---

### Task 12: Implement OAuth Provider
**File:** `src/features/skill-mcp-manager/oauth/provider.ts`
**Action:** CREATE
**Description:** OAuthClientProvider implementation for MCP SDK

**What to do:**
- Import types from `@modelcontextprotocol/sdk/shared/auth`
- Import storage functions from `./storage`
- Define `SkillMcpOAuthProvider` class implementing SDK's `OAuthClientProvider` interface:
  ```typescript
  class SkillMcpOAuthProvider implements OAuthClientProvider {
    constructor(
      serverUrl: string,
      redirectUrl: string | URL,
      clientMetadata: OAuthClientMetadata,
      onRedirect: (url: URL) => void
    )
    
    get redirectUrl(): string | URL
    get clientMetadata(): OAuthClientMetadata
    clientInformation(): OAuthClientInformation | undefined
    saveClientInformation(info: OAuthClientInformationFull): void
    tokens(): OAuthTokens | undefined
    saveTokens(tokens: OAuthTokens): void
    redirectToAuthorization(authorizationUrl: URL): void
    saveCodeVerifier(codeVerifier: string): void
    codeVerifier(): string
  }
  ```
- Load existing credentials from storage on construction
- Persist changes to storage on save operations

**Reference:** Smithery cookbook oauth-client.ts pattern

**What NOT to do:**
- Don't implement browser opening (just call onRedirect)
- Don't implement token refresh (SDK handles it)

**Acceptance Criteria:**
- [ ] Task 11 tests pass
- [ ] Implements MCP SDK's OAuthClientProvider interface

---

### Task 13: Add PKCE Generation Helper
**File:** `src/features/skill-mcp-manager/oauth/provider.ts`
**Action:** MODIFY
**Description:** Add PKCE helper using existing package

**What to do:**
- Import `generatePKCE` from `@openauthjs/openauth/pkce`
- Export helper function `generatePKCEPair()`:
  ```typescript
  export async function generatePKCEPair(): Promise<{
    verifier: string
    challenge: string
    method: string
  }>
  ```

**Reference:** `src/auth/antigravity/oauth.ts` lines 73-80

**What NOT to do:**
- Don't implement PKCE from scratch
- Don't add new dependencies

**Acceptance Criteria:**
- [ ] PKCE generation works
- [ ] Uses existing `@openauthjs/openauth/pkce` package

---

### Task 14: Add OAuth Flow Orchestration
**File:** `src/features/skill-mcp-manager/oauth/provider.ts`
**Action:** MODIFY
**Description:** Add high-level OAuth flow function

**What to do:**
- Export `performMcpOAuthFlow(serverUrl, config, openBrowser)`:
  ```typescript
  export async function performMcpOAuthFlow(
    serverUrl: string,
    config?: McpOAuthConfig,
    openBrowser?: (url: string) => Promise<void>
  ): Promise<SkillMcpOAuthProvider>
  ```
- Create callback server
- Build auth URL with PKCE
- Call openBrowser if provided
- Wait for callback
- Return configured provider

**What NOT to do:**
- Don't handle token exchange here (SDK does it)

**Acceptance Criteria:**
- [ ] Flow integrates callback server and provider
- [ ] openBrowser callback optional

---

### Task 15: Export OAuth Module Complete
**File:** `src/features/skill-mcp-manager/oauth/index.ts`
**Action:** MODIFY
**Description:** Export all OAuth components

**What to do:**
- Export `SkillMcpOAuthProvider`
- Export `performMcpOAuthFlow`
- Export `generatePKCEPair`
- Export `startCallbackServer`
- Export all types

**Acceptance Criteria:**
- [ ] All OAuth components accessible from barrel export

---

### Task 16: Verify Phase 2 Completion
**Action:** RUN
**Commands:**
- `bun test src/features/skill-mcp-manager/oauth/`
- `bun run typecheck`

**Acceptance Criteria:**
- [ ] All OAuth tests pass
- [ ] No type errors

---

## Phase 3: HTTP Transport Integration (Tasks 17-23)

### Task 17: Write HTTP Transport Factory Tests (TDD)
**File:** `src/features/skill-mcp-manager/http-transport.test.ts`
**Action:** CREATE
**Description:** Test transport factory

**What to do:**
- Test `createTransport(config)` returns StdioClientTransport for command config
- Test `createTransport(config)` returns StreamableHTTPClientTransport for url config
- Test `createTransport(config)` with oauth=true creates provider
- Test `createTransport(config)` throws for invalid config (no command or url)
- Test transport type detection based on `type` field

**What NOT to do:**
- Don't test actual MCP connections

**Acceptance Criteria:**
- [ ] Tests use #given, #when, #then
- [ ] Tests cover all transport types

---

### Task 18: Implement HTTP Transport Factory
**File:** `src/features/skill-mcp-manager/http-transport.ts`
**Action:** CREATE
**Description:** Factory for creating appropriate MCP transport

**What to do:**
- Import transports from MCP SDK:
  ```typescript
  import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
  import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
  import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
  ```
- Define `TransportConfig` type with all options
- Implement `createTransport(config, oauthProvider?)`:
  - If `command` present → StdioClientTransport
  - If `url` present with `type: "sse"` → SSEClientTransport
  - If `url` present → StreamableHTTPClientTransport
  - Pass `authProvider` option if oauthProvider provided
- Implement `detectTransportType(config)`:
  - Check `type` field first
  - Infer from `url` vs `command`

**What NOT to do:**
- Don't instantiate Client here (just transport)

**Acceptance Criteria:**
- [ ] Task 17 tests pass
- [ ] All three transport types supported

---

### Task 19: Add OAuth Integration to Transport Factory
**File:** `src/features/skill-mcp-manager/http-transport.ts`
**Action:** MODIFY
**Description:** Integrate OAuth provider with HTTP transports

**What to do:**
- Add `createTransportWithOAuth(config, serverUrl)`:
  ```typescript
  export async function createTransportWithOAuth(
    config: ClaudeCodeMcpServer,
    serverUrl: string,
    onAuthRequired: (authUrl: string) => void
  ): Promise<{
    transport: Transport
    status: McpServerStatus
    provider?: SkillMcpOAuthProvider
  }>
  ```
- Check if `config.oauth` is enabled
- If oauth, create SkillMcpOAuthProvider
- Check existing tokens - if valid, return connected
- If no tokens, signal needs_auth status
- Handle dynamic client registration status

**What NOT to do:**
- Don't block waiting for OAuth completion

**Acceptance Criteria:**
- [ ] OAuth-enabled configs get provider
- [ ] Status correctly reflects auth state

---

### Task 20: Update Manager - Add Transport Detection
**File:** `src/features/skill-mcp-manager/manager.ts`
**Action:** MODIFY
**Description:** Refactor createClient to use transport factory

**What to do:**
- Import `createTransport` from `./http-transport`
- Refactor `createClient()` method:
  - Detect transport type
  - Use factory for transport creation
  - Keep existing StdioClientTransport logic for backward compat
- Add `getTransportType(config)` helper method

**What NOT to do:**
- Don't change method signatures
- Don't remove existing functionality

**Acceptance Criteria:**
- [ ] Existing stdio tests pass
- [ ] New HTTP configs use factory

---

### Task 21: Update Manager - Add OAuth Support
**File:** `src/features/skill-mcp-manager/manager.ts`
**Action:** MODIFY
**Description:** Integrate OAuth flow into manager

**What to do:**
- Add `oauthProviders: Map<string, SkillMcpOAuthProvider>` field
- Add `onAuthRequired?: (serverName: string, authUrl: string) => void` constructor option
- Modify `getOrCreateClient()`:
  - Check if HTTP transport with oauth
  - Use `createTransportWithOAuth`
  - Handle `needs_auth` status by calling onAuthRequired
  - Return status in context
- Add `completeOAuth(serverName: string, authCode: string)`:
  - Get stored provider
  - Call `transport.finishAuth(authCode)`
  - Reconnect client

**What NOT to do:**
- Don't change existing stdio behavior
- Don't block on OAuth completion

**Acceptance Criteria:**
- [ ] OAuth flow can be initiated
- [ ] Auth completion reconnects client

---

### Task 22: Update Manager Tests
**File:** `src/features/skill-mcp-manager/manager.test.ts`
**Action:** MODIFY
**Description:** Add tests for HTTP transport and OAuth

**What to do:**
- Add test: HTTP config without oauth connects
- Add test: HTTP config with oauth but no tokens returns needs_auth
- Add test: HTTP config with valid tokens connects
- Add test: completeOAuth finishes auth flow
- Mock transports and OAuth provider

**What NOT to do:**
- Don't remove existing tests

**Acceptance Criteria:**
- [ ] All existing tests pass
- [ ] New tests cover OAuth flows

---

### Task 23: Verify Phase 3 Completion
**Action:** RUN
**Commands:**
- `bun test src/features/skill-mcp-manager/`
- `bun run typecheck`

**Acceptance Criteria:**
- [ ] All manager tests pass
- [ ] Type check passes

---

## Phase 4: Tool & Schema Updates (Tasks 24-29)

### Task 24: Update skill_mcp Tool Description
**File:** `src/tools/skill-mcp/constants.ts`
**Action:** MODIFY
**Description:** Update description to mention OAuth support

**What to do:**
- Update `SKILL_MCP_DESCRIPTION` to mention:
  - Supports remote MCP servers with OAuth
  - May return `needs_auth` status requiring browser auth

**Acceptance Criteria:**
- [ ] Description clearly explains OAuth behavior

---

### Task 25: Add Status to Tool Output
**File:** `src/tools/skill-mcp/tools.ts`
**Action:** MODIFY
**Description:** Surface server status in tool responses

**What to do:**
- Add status checking before operations
- Return informative error when `needs_auth`:
  ```
  MCP server "X" requires OAuth authentication.
  Status: needs_auth
  
  To authenticate:
  1. Open the authorization URL in browser
  2. Complete the login flow
  3. Try again
  ```
- Add `status` field to successful responses

**What NOT to do:**
- Don't block tool execution waiting for auth

**Acceptance Criteria:**
- [ ] Status clearly communicated in responses
- [ ] Users know what action to take

---

### Task 26: Add OAuth Config Schema
**File:** `src/config/schema.ts`
**Action:** MODIFY
**Description:** Add schema for MCP OAuth configuration

**What to do:**
- Define `McpOAuthConfigSchema`:
  ```typescript
  const McpOAuthConfigSchema = z.object({
    clientId: z.string().optional(),
    clientSecret: z.string().optional(),
    scope: z.string().optional(),
  })
  ```
- Add to appropriate config section
- Update `OhMyOpenCodeConfigSchema` if needed

**What NOT to do:**
- Don't make oauth config required

**Acceptance Criteria:**
- [ ] Schema validates correctly
- [ ] Optional fields work

---

### Task 27: Update Tool Tests
**File:** `src/tools/skill-mcp/tools.test.ts`
**Action:** CREATE (if not exists) or MODIFY
**Description:** Test status handling in tool

**What to do:**
- Test tool returns error for needs_auth status
- Test tool includes status in output
- Test tool works normally for connected servers

**Acceptance Criteria:**
- [ ] Status handling tested

---

### Task 28: Build Schema
**Action:** RUN
**Command:** `bun run build:schema`

**Acceptance Criteria:**
- [ ] Schema builds without errors
- [ ] JSON schema updated

---

### Task 29: Verify Phase 4 Completion
**Action:** RUN
**Commands:**
- `bun test`
- `bun run typecheck`
- `bun run build`

**Acceptance Criteria:**
- [ ] All tests pass
- [ ] Build succeeds

---

## Phase 5: Integration & Documentation (Tasks 30-34)

### Task 30: Integration Test - Stdio Unchanged
**Action:** VERIFY
**Description:** Ensure existing stdio MCPs work

**What to do:**
- Run existing playwright skill test
- Verify skill_mcp tool works with stdio config

**Acceptance Criteria:**
- [ ] Stdio MCP servers work as before

---

### Task 31: Integration Test - HTTP Transport
**Action:** MANUAL TEST
**Description:** Test HTTP transport with real server

**What to do:**
- Create test skill with HTTP MCP config
- Test connection without oauth
- Verify tools, resources, prompts work

**Acceptance Criteria:**
- [ ] HTTP MCP can connect and operate

---

### Task 32: Integration Test - OAuth Flow
**Action:** MANUAL TEST
**Description:** Test full OAuth flow

**What to do:**
- Create test skill with oauth: true
- Verify needs_auth status returned
- Test browser opens with auth URL
- Complete auth and verify connection

**Acceptance Criteria:**
- [ ] Full OAuth flow works end-to-end

---

### Task 33: Update AGENTS.md
**File:** `src/features/skill-mcp-manager/AGENTS.md`
**Action:** CREATE
**Description:** Document skill-mcp-manager module

**What to do:**
- Document module purpose
- List key components (manager, oauth/, transport)
- Document OAuth flow
- Document status states
- Add usage examples

**Acceptance Criteria:**
- [ ] Documentation complete and accurate

---

### Task 34: Final Verification
**Action:** RUN
**Commands:**
- `bun test`
- `bun run typecheck`
- `bun run build`

**Acceptance Criteria:**
- [ ] All tests pass (380+)
- [ ] No type errors
- [ ] Build succeeds
- [ ] No regressions

---

## Files Summary

### New Files to Create:
| File | Purpose |
|------|---------|
| `src/features/skill-mcp-manager/oauth/index.ts` | Barrel export for OAuth module |
| `src/features/skill-mcp-manager/oauth/types.ts` | OAuth-specific types |
| `src/features/skill-mcp-manager/oauth/storage.ts` | Token/credential storage |
| `src/features/skill-mcp-manager/oauth/storage.test.ts` | Storage tests |
| `src/features/skill-mcp-manager/oauth/provider.ts` | OAuthClientProvider implementation |
| `src/features/skill-mcp-manager/oauth/provider.test.ts` | Provider tests |
| `src/features/skill-mcp-manager/oauth/callback.ts` | HTTP callback server |
| `src/features/skill-mcp-manager/oauth/callback.test.ts` | Callback tests |
| `src/features/skill-mcp-manager/http-transport.ts` | StreamableHTTP/SSE transport factory |
| `src/features/skill-mcp-manager/http-transport.test.ts` | Transport factory tests |
| `src/features/skill-mcp-manager/AGENTS.md` | Module documentation |

### Files to Modify:
| File | Changes |
|------|---------|
| `src/features/skill-mcp-manager/types.ts` | Add status types, extend SkillMcpClientInfo |
| `src/features/skill-mcp-manager/manager.ts` | Add HTTP/SSE transport support, OAuth integration |
| `src/features/skill-mcp-manager/manager.test.ts` | Add new tests |
| `src/features/skill-mcp-manager/index.ts` | Export new modules |
| `src/features/claude-code-mcp-loader/types.ts` | Extend ClaudeCodeMcpServer with oauth field |
| `src/tools/skill-mcp/tools.ts` | Status handling in tool output |
| `src/tools/skill-mcp/constants.ts` | Updated description mentioning OAuth |
| `src/config/schema.ts` | Add MCP OAuth config schema |

---

## Definition of Done

1. ✅ All existing tests pass (backward compatibility)
2. ✅ New tests cover OAuth storage, provider, callback, transport factory
3. ✅ TypeScript compiles without errors
4. ✅ Build completes successfully
5. ✅ Stdio MCPs continue working unchanged
6. ✅ HTTP MCPs can connect with and without OAuth
7. ✅ OAuth flow completes with browser-based auth
8. ✅ Tokens persist and reuse across sessions
9. ✅ Status tracking works for all states
10. ✅ Documentation updated

## Must NOT Have

- ❌ `as any`, `@ts-ignore`, `@ts-expect-error` type assertions
- ❌ npm/npx commands (use bun only)
- ❌ Synchronous file operations for storage
- ❌ Hardcoded OAuth tokens or credentials
- ❌ Breaking changes to existing types (only additive)
- ❌ Removal of existing functionality
- ❌ Tests without BDD comments (#given, #when, #then)
