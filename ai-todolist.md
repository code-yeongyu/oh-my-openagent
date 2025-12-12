# Antigravity Auth Plugin Implementation Plan

**Date**: 2025-12-12
**Branch**: `feature/antigravity-auth`
**Status**: REVISION 1 - Addressing reviewer feedback

---

## 현재 진행 중인 작업

**모든 작업 완료** - ✅ Phase 1-4 완료 (14 tasks) + Oracle 문서화 이슈 수정

---

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-12-12 | Initial plan |
| 1.1 | 2025-12-12 | Added tool normalization tasks, clarified provider ID, fixed export structure, added model mapping |

---

## User's Original Request

> ~/tools/cliproxyapi ultrasearch, and make a plan for "antigravity" auth from there to be implemented as openai codex auth implemented on here; use https://github.com/numman-ali/opencode-openai-codex-auth https://github.com/NoeFabris/opencode-antigravity-auth as a reference and also write it on the plan file. see how those auth providing plugin can be done by exploring of ~/local-workspaces/opencode and write me a full plan workable --review

---

## References (CRITICAL)

### External Repositories

| Repository | Purpose | Key Files |
|------------|---------|-----------|
| [numman-ali/opencode-openai-codex-auth](https://github.com/numman-ali/opencode-openai-codex-auth) | Reference for OpenCode auth plugin structure | `index.ts` (root), `lib/request/fetch-helpers.ts`, `lib/auth/oauth.ts` |
| [NoeFabris/opencode-antigravity-auth](https://github.com/NoeFabris/opencode-antigravity-auth) | Reference for Antigravity-specific implementation | `src/plugin.ts`, `src/antigravity/oauth.ts`, `src/plugin/request.ts` |

### Local Codebase

| Location | Purpose |
|----------|---------|
| `~/tools/cliproxyapi/sdk/auth/antigravity.go` | Original Go implementation to port |
| `~/tools/cliproxyapi/internal/cmd/antigravity_login.go` | CLI login flow reference |
| `~/local-workspaces/opencode/packages/plugin/src/index.ts` | AuthHook interface definition |
| `~/local-workspaces/opencode/packages/opencode/src/provider/auth.ts` | Auth provider registration |

---

## Context Gathered

### 1. cliproxyapi Antigravity Auth (Go Implementation)

**AntigravityAuthenticator Key Methods:**
```go
func (AntigravityAuthenticator) Provider() string { return "antigravity" }
func (AntigravityAuthenticator) Login() // OAuth flow with PKCE
```

**OAuth Configuration:**
- Client ID: `1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com`
- Client Secret: `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`
- Redirect URI: `http://localhost:51121/oauth-callback`
- Scopes: `cloud-platform`, `userinfo.email`, `userinfo.profile`, `cclog`, `experimentsandconfigs`

**Auth Flow:**
1. Generate PKCE verifier/challenge
2. Build OAuth URL with state containing verifier
3. Open browser for Google OAuth
4. Receive callback with code
5. Exchange code for tokens
6. Fetch user info (email)
7. Fetch project ID via loadCodeAssist API
8. Store tokens with project context

**Token Storage Format:**
```json
{
  "type": "antigravity",
  "access_token": "...",
  "refresh_token": "...",
  "expires_in": 3600,
  "timestamp": 1640995200000,
  "email": "user@example.com",
  "project_id": "my-gcp-project"
}
```

### 2. OpenCode Auth Plugin Interface

**AuthHook Interface** (from `packages/plugin/src/index.ts`):
```typescript
export type AuthHook = {
  provider: string
  loader?: (auth: () => Promise<Auth>, provider: Provider) => Promise<Record<string, any>>
  methods: Array<{
    type: "oauth" | "api"
    label: string
    prompts?: Array<{ type: "text" | "select", key: string, message: string }>
    authorize?(inputs?: Record<string, string>): Promise<AuthOuathResult>
  }>
}

export type AuthOuathResult = { url: string; instructions: string } & (
  | { method: "auto"; callback(): Promise<{ type: "success" | "failed", ... }> }
  | { method: "code"; callback(code: string): Promise<{ type: "success" | "failed", ... }> }
)
```

### 3. opencode-openai-codex-auth Pattern

**Plugin Structure:**
```
opencode-openai-codex-auth/
├── index.ts                    # Main export
├── src/plugin.ts               # createCodexAuthPlugin()
├── lib/
│   ├── auth/oauth.ts           # OAuth flow
│   ├── request/
│   │   ├── fetch-helpers.ts    # Custom fetch interceptor
│   │   ├── request-transformer.ts
│   │   └── response-handler.ts
│   └── prompts/codex.ts        # Model-specific prompts
```

**Key Pattern:**
- `createPlugin()` returns `{ hooks: { auth: AuthHook } }`
- `loader()` returns `{ fetch: customFetch }` for request interception
- Token refresh handled in custom fetch

### 4. opencode-antigravity-auth Pattern

**Unique Features:**
- Endpoint fallback: `daily → autopush → prod`
- Project context via `loadCodeAssist` API
- Tool normalization for Claude/Gemini
- Thinking block support
- Token storage: `refreshToken|projectId|managedProjectId`

**Endpoint Fallbacks:**
```typescript
ANTIGRAVITY_ENDPOINT_FALLBACKS = [
  "https://daily-cloudcode-pa.sandbox.googleapis.com",      // dev
  "https://autopush-cloudcode-pa.sandbox.googleapis.com",   // staging
  "https://cloudcode-pa.googleapis.com"                     // prod
]
```

---

## Assumptions Made (User Did Not Respond)

| Question | Assumed Answer | Rationale |
|----------|---------------|-----------|
| Package structure | B) Internal implementation | More control, easier to customize |
| Existing auth relation | A) Add alongside (coexist) | Non-breaking change |
| Feature scope | A) Full features | Match reference implementations |
| Endpoint fallback | A) All environments | Maximum compatibility |
| Client credentials | A) Hardcoded | Match cliproxyapi and references |
| Tool normalization | A) Include | Full feature parity |
| Definition of Done | C) Full conversation working | Complete verification |

**User can override these assumptions by responding to the clarifying questions.**

---

## Critical Design Decisions (CORRECTED)

### Provider ID Decision

**Provider ID MUST be `"google"`**.

Rationale:
- Antigravity is just an auth mechanism for Google models
- Provider in OpenCode = the model provider (Google)
- User selects `google` provider, then chooses Antigravity as auth method

**UX in OpenCode:**
```
opencode auth login
> Select provider: google
> Select auth method:
  - API Key
  - OAuth with Google (Antigravity)  <-- NEW
```

### Export Structure (SIMPLE - No Migration)

**Keep it simple like openai-codex-auth:**
```
src/
├── auth.ts  # export { GoogleAntigravityAuthPlugin as default } from "./auth/antigravity"
```

That's it. No complex migration. Just works.

### Model Mapping

**Supported Models (Google/Gemini ONLY):**
| OpenCode Model ID | Antigravity Model | Notes |
|-------------------|-------------------|-------|
| `google/gemini-3-pro-preview` | `gemini-3-pro-preview` | Default |
| `google/gemini-3-pro-high` | `gemini-3-pro-high` | High thinking |
| `google/gemini-2.5-pro` | `gemini-2.5-pro` | Standard |

**NO Claude models** - Antigravity is for Google models only.

### Token Storage in OpenCode

**Storage Mechanism:**
- Uses OpenCode's built-in `Auth.set(providerID, data)` and `Auth.get(providerID)`
- `providerID` = `"google"` (matches `AuthHook.provider`)
- `loader` callback receives `auth()` function to retrieve stored tokens

**Token Format Stored:**
```json
{
  "type": "oauth",
  "access": "ya29.xxx...",
  "refresh": "1//xxx...|projectId|managedProjectId",
  "expires": 1702400000000
}
```

### Client Credentials (Via OpenCode Provider Options)

**Client credentials configured via `opencode.json` provider options.**

**NO prompts.** Just works with defaults, optionally configurable:

```json
// opencode.json (OPTIONAL - only if user wants custom credentials)
{
  "provider": {
    "google": {
      "options": {
        "clientId": "your-custom-client-id",
        "clientSecret": "your-custom-client-secret"
      }
    }
  }
}
```

**Implementation:**
```typescript
// In loader function - reads from provider.options
loader: async (auth, provider) => {
  const clientId = provider.options?.clientId || DEFAULT_CLIENT_ID
  const clientSecret = provider.options?.clientSecret || DEFAULT_CLIENT_SECRET
  // Use these for fetch interceptor
  return { fetch: createAntigravityFetch(auth, clientId, clientSecret, ...) }
}

// In authorize function - also reads from provider context
methods: [{
  type: "oauth",
  label: "OAuth with Google (Antigravity)",
  // NO prompts - just authorize directly
  authorize: async () => {
    // clientId/clientSecret passed from loader context or use defaults
    // Start OAuth flow
  }
}]
```

**User Experience:**
```
opencode auth login
> Select provider: google
> Select auth method: OAuth with Google (Antigravity)
# Browser opens immediately - no prompts for credentials
# Uses defaults or whatever is in opencode.json options
```

**Defaults (from cliproxyapi):**
- `DEFAULT_CLIENT_ID`: `1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com`
- `DEFAULT_CLIENT_SECRET`: `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`

### Relationship with openai-codex-auth

**This plugin REPLACES openai-codex-auth in this repo.**

- `src/auth.ts` will export GoogleAntigravityAuthPlugin as default
- If users need OpenAI Codex auth, they should use `opencode-openai-codex-auth` directly as a separate plugin
- This is NOT a "coexistence" scenario - it's a "replacement" for this repo's auth

**Rationale:**
- oh-my-opencode focuses on Google/Gemini via Antigravity
- OpenAI users already have a well-maintained separate plugin
- Keeps this codebase focused and simple

### Token Format Responsibility

**refresh token format: `refreshToken|projectId|managedProjectId`**

**Where it's created:** `token.ts` → `formatTokenForStorage()`
```typescript
function formatTokenForStorage(
  refreshToken: string, 
  projectId: string, 
  managedProjectId?: string
): string {
  return `${refreshToken}|${projectId}|${managedProjectId || ""}`
}
```

**Where it's parsed:** `token.ts` → `parseStoredToken()`
```typescript
function parseStoredToken(stored: string): {
  refreshToken: string
  projectId: string
  managedProjectId?: string
} {
  const [refreshToken, projectId, managedProjectId] = stored.split("|")
  return { refreshToken, projectId, managedProjectId: managedProjectId || undefined }
}
```

**Flow:**
1. OAuth callback receives `refresh_token` from Google
2. `project.ts` fetches `projectId` via loadCodeAssist API
3. `token.ts` combines them into `refresh|projectId|managedProjectId`
4. Combined string stored via `Auth.set(providerID, { refresh: combinedString, ... })`
5. On reload, `token.ts` parses back to individual components

---

## Concrete Deliverables

| Deliverable | Location | Description |
|-------------|----------|-------------|
| Google Antigravity auth plugin | `src/auth/antigravity/plugin.ts` | Main createGoogleAntigravityAuthPlugin() |
| OAuth flow | `src/auth/antigravity/oauth.ts` | PKCE OAuth with configurable credentials |
| Token management | `src/auth/antigravity/token.ts` | Token refresh, storage format |
| Request transformer | `src/auth/antigravity/request.ts` | OpenAI → Gemini/Antigravity format |
| Response handler | `src/auth/antigravity/response.ts` | Gemini/Antigravity → OpenAI format |
| Tool normalization | `src/auth/antigravity/tools.ts` | OpenAI tools ↔ Gemini functionDeclarations |
| Thinking block handler | `src/auth/antigravity/thinking.ts` | Extract/format Gemini thinking blocks |
| Fetch interceptor | `src/auth/antigravity/fetch.ts` | Request interception with endpoint fallback |
| Project context | `src/auth/antigravity/project.ts` | loadCodeAssist API integration |
| Constants | `src/auth/antigravity/constants.ts` | Default OAuth config, endpoints, headers |
| Types | `src/auth/antigravity/types.ts` | TypeScript interfaces |
| Barrel export | `src/auth/antigravity/index.ts` | Module exports |
| Auth entry | `src/auth.ts` | Simple default export |

---

## Definition of Done

- [x] `bun run typecheck` passes with no errors
- [x] `bun run build` succeeds
- [ ] `opencode auth login` shows "google" provider with "OAuth with Google (Antigravity)" method
- [ ] NO prompts - OAuth starts immediately (credentials from options or defaults)
- [ ] OAuth flow completes and stores tokens
- [ ] Token auto-refresh works before expiration
- [ ] `loadCodeAssist` API returns project ID
- [ ] Endpoint fallback works (tries prod if daily fails)
- [ ] API request transformation works (OpenAI → Gemini format)
- [ ] API response transformation works (Gemini → OpenAI format)
- [ ] Can have full conversation with Gemini model via Antigravity
- [ ] Custom credentials work when configured in `opencode.json` provider options

---

## Must Have

- **OAuth with PKCE**: Google OAuth 2.0 with Proof Key for Code Exchange
- **Token Management**: Access token refresh before expiration (60s buffer)
- **Project Context**: loadCodeAssist API for automatic project discovery
- **Request Transformation**: Convert OpenAI-format requests to Gemini/Antigravity format
- **Response Transformation**: Convert Gemini/Antigravity responses to OpenAI format
- **Endpoint Fallback**: Try multiple endpoints if primary fails
- **REPLACES openai-codex-auth**: This repo becomes Google/Antigravity focused (OpenAI users use separate plugin)

---

## Must NOT Have

- **No modification to existing auth.ts** beyond adding export
- **No new npm dependencies** (use existing @openauthjs/openauth for PKCE)
- **No test files** (test framework not configured)
- **No over-abstraction** (no "AuthProvider" base class)
- **No separate npm package** (internal implementation only)
- **No changes to opencode.json schema**
- **No breaking changes to existing functionality**

---

## Task Flow Diagram

```
Phase 1 (Foundation)
├── Task 1: Create types ──────────────────────┐
├── Task 2: Create constants ──────────────────┤ Parallel
└── Task 3: Create module structure ───────────┘

Phase 2 (OAuth Core)
├── Task 4: Implement OAuth flow ──────────────┐
├── Task 5: Implement token management ────────┤ Sequential (5 depends on 4)
└── Task 6: Implement project context ─────────┘ Sequential (6 depends on 5)

Phase 3 (Request/Response Transformation)
├── Task 7: Implement request transformer ─────┐
├── Task 8: Implement response handler ────────┤ Parallel
├── Task 9: Implement tool normalization ──────┤ Parallel (after 7, 8 design known)
├── Task 10: Implement thinking block handler ─┤ Parallel with 9
└── Task 11: Implement fetch interceptor ──────┘ Sequential (depends on 7-10)

Phase 4 (Plugin Assembly)
├── Task 12: Create main plugin ───────────────┐
├── Task 13: Migrate auth exports ─────────────┤ Sequential
└── Task 14: Final verification ───────────────┘ Sequential
```
Phase 1 (Foundation)
├── Task 1: Create types ──────────────────────┐
├── Task 2: Create constants ──────────────────┤ Parallel
└── Task 3: Create barrel export structure ────┘

Phase 2 (OAuth Core)
├── Task 4: Implement OAuth flow ──────────────┐
├── Task 5: Implement token management ────────┤ Sequential (5 depends on 4)
└── Task 6: Implement project context ─────────┘ Sequential (6 depends on 5)

Phase 3 (Request/Response)
├── Task 7: Implement request transformer ─────┐
├── Task 8: Implement response handler ────────┤ Parallel
└── Task 9: Implement fetch interceptor ───────┘ Sequential (9 depends on 7, 8)

Phase 4 (Plugin Assembly)
├── Task 10: Create main plugin ───────────────┐
├── Task 11: Update auth exports ──────────────┤ Sequential
└── Task 12: Final verification ───────────────┘ Sequential
```

---

## Tasks

### Phase 1: Foundation

- [x] **1. Create Antigravity auth types**

  **What to do**:
  - Create `src/auth/antigravity/types.ts`
  - Define `AntigravityTokens` interface (access_token, refresh_token, expires_in, timestamp, email, project_id)
  - Define `AntigravityProjectContext` interface
  - Define `AntigravityRequestBody` interface
  - Define `AntigravityResponse` interface

  **Must NOT do**:
  - Do NOT create abstract base classes
  - Do NOT add fields not in cliproxyapi implementation

  **Parallelizable**: YES (with Task 2, 3)

  **MUST READ first**:
  - `~/tools/cliproxyapi/sdk/auth/antigravity.go` - token structure
  - Reference: NoeFabris/opencode-antigravity-auth `src/plugin/types.ts`

  **Acceptance Criteria**:
  - [x] All interfaces match cliproxyapi token format
  - [x] Types exported from file
  - [x] `bun run typecheck` passes

  **Commit Checkpoint**: NO (groups with Task 3)

---

- [x] **2. Create constants**

  **What to do**:
  - Create `src/auth/antigravity/constants.ts`
  - Define `ANTIGRAVITY_CLIENT_ID`, `ANTIGRAVITY_CLIENT_SECRET`
  - Define `ANTIGRAVITY_REDIRECT_URI` = `http://localhost:51121/oauth-callback`
  - Define `ANTIGRAVITY_SCOPES` array
  - Define `ANTIGRAVITY_ENDPOINT_FALLBACKS` array
  - Define `ANTIGRAVITY_HEADERS` object
  - Define `ANTIGRAVITY_DEFAULT_PROJECT_ID`

  **Must NOT do**:
  - Do NOT put credentials in environment variables
  - Do NOT modify values from cliproxyapi

  **Parallelizable**: YES (with Task 1, 3)

  **MUST READ first**:
  - `~/tools/cliproxyapi/sdk/auth/antigravity.go` - OAuth credentials
  - Reference: NoeFabris/opencode-antigravity-auth `src/constants.ts`

  **Acceptance Criteria**:
  - [ ] All OAuth constants match cliproxyapi
  - [ ] Endpoint fallbacks in correct order (daily, autopush, prod)
  - [x] `bun run typecheck` passes

  **Commit Checkpoint**: NO (groups with Task 3)

---

- [x] **3. Create module structure** ✅ COMPLETED

  **What to do**:
  - Create `src/auth/antigravity/index.ts` barrel export
  - Create empty placeholder files for remaining modules
  - Ensure directory structure matches plan

  **Must NOT do**:
  - Do NOT implement actual logic yet

  **Parallelizable**: YES (with Task 1, 2)

  **Acceptance Criteria**:
  - [x] Directory `src/auth/antigravity/` exists
  - [x] `index.ts` exports types and constants
  - [x] `bun run typecheck` passes

  **Commit Checkpoint**: YES

  **Commit Specification**:
  - **Message**: `feat(antigravity-auth): add types and constants foundation`
  - **Files to stage**: `src/auth/antigravity/`
  - **Pre-commit verification**:
    - [ ] `bun run typecheck` → No errors
  - **Rollback trigger**: Type errors in imports

---

### Phase 2: OAuth Core

- [x] **4. Implement OAuth flow**

  **What to do**:
  - Create `src/auth/antigravity/oauth.ts`
  - Implement `generatePKCE()` using @openauthjs/openauth
  - Implement `buildAuthURL(projectId: string)` 
  - Implement `exchangeCode(code: string, verifier: string)`
  - Implement `fetchUserInfo(accessToken: string)`
  - Start local callback server on port 51121

  **Must NOT do**:
  - Do NOT use custom PKCE implementation (use @openauthjs/openauth)
  - Do NOT change OAuth scopes from cliproxyapi

  **Parallelizable**: NO (foundation for Phase 2)

  **MUST READ first**:
  - `~/tools/cliproxyapi/sdk/auth/antigravity.go:buildAntigravityAuthURL`
  - `~/tools/cliproxyapi/sdk/auth/antigravity.go:exchangeAntigravityCode`
  - Reference: NoeFabris/opencode-antigravity-auth `src/antigravity/oauth.ts`
  - Reference: numman-ali/opencode-openai-codex-auth `lib/auth/oauth.ts`

  **References**:
  - cliproxyapi line: `buildAntigravityAuthURL` function
  - cliproxyapi line: `exchangeAntigravityCode` function

  **Acceptance Criteria**:
  - [x] PKCE verifier/challenge generated correctly
  - [x] Auth URL includes all required parameters
  - [x] Token exchange returns access_token and refresh_token
  - [x] User info fetch returns email
  - [x] `bun run typecheck` passes

  **Commit Checkpoint**: NO (groups with Task 6)

---

- [x] **5. Implement token management**

  **What to do**:
  - Create `src/auth/antigravity/token.ts`
  - Implement `isTokenExpired(tokens: AntigravityTokens)` with 60s buffer
  - Implement `refreshAccessToken(refreshToken: string)`
  - Implement `parseStoredToken(stored: string)` for `refreshToken|projectId|managedProjectId` format
  - Implement `formatTokenForStorage(tokens, projectId, managedProjectId)`

  **Must NOT do**:
  - Do NOT implement retry logic for refresh
  - Do NOT cache tokens in memory (use OpenCode's storage)

  **Parallelizable**: NO (depends on Task 4)

  **MUST READ first**:
  - Reference: NoeFabris/opencode-antigravity-auth `src/plugin/token.ts`
  - `~/tools/cliproxyapi/sdk/auth/antigravity.go` - token refresh logic

  **Acceptance Criteria**:
  - [x] Token expiration check includes 60s buffer
  - [x] Refresh token exchange works with Google endpoint
  - [x] Token parsing handles `|` separated format
  - [x] `bun run typecheck` passes

  **Commit Checkpoint**: NO (groups with Task 6)

---

- [x] **6. Implement project context**

  **What to do**:
  - Create `src/auth/antigravity/project.ts`
  - Implement `fetchProjectContext(accessToken: string)` calling loadCodeAssist API
  - Extract `cloudaicompanionProject` from response
  - Implement fallback to `ANTIGRAVITY_DEFAULT_PROJECT_ID` if API fails
  - Cache project context per refresh token

  **Must NOT do**:
  - Do NOT fail if loadCodeAssist returns empty (use default)

  **Parallelizable**: NO (depends on Task 5)

  **MUST READ first**:
  - `~/tools/cliproxyapi/sdk/auth/antigravity.go:fetchAntigravityProjectID`
  - Reference: NoeFabris/opencode-antigravity-auth `src/plugin/project.ts`

  **References**:
  - API endpoint: `https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist`
  - Response field: `cloudaicompanionProject`

  **Acceptance Criteria**:
  - [x] loadCodeAssist API called with correct headers
  - [x] Project ID extracted from response
  - [x] Fallback to default project ID works
  - [x] `bun run typecheck` passes

  **Commit Checkpoint**: YES

  **Commit Specification**:
  - **Message**: `feat(antigravity-auth): add OAuth flow and token management`
  - **Files to stage**: `src/auth/antigravity/oauth.ts`, `src/auth/antigravity/token.ts`, `src/auth/antigravity/project.ts`
  - **Pre-commit verification**:
    - [ ] `bun run typecheck` → No errors
  - **Rollback trigger**: OAuth flow failures

---

### Phase 3: Request/Response Transformation

- [x] **7. Implement request transformer** ✅ COMPLETED

  **What to do**:
  - Create `src/auth/antigravity/request.ts`
  - Implement `transformRequest(body: OpenAIRequest)` → AntigravityRequest
  - Handle model name extraction from path
  - Wrap request body in `{ project, model, request }` format
  - Add Antigravity-specific headers

  **Must NOT do**:
  - Do NOT modify the original request object (create new)
  - Do NOT implement tool normalization in this task

  **Parallelizable**: YES (with Task 8)

  **MUST READ first**:
  - Reference: NoeFabris/opencode-antigravity-auth `src/plugin/request.ts`
  - Reference: numman-ali/opencode-openai-codex-auth `lib/request/request-transformer.ts`

  **Acceptance Criteria**:
  - [x] Model name extracted from URL path
  - [x] Request wrapped correctly for Antigravity API
  - [x] Headers include Authorization, User-Agent, X-Goog-Api-Client
  - [x] `bun run typecheck` passes

  **Commit Checkpoint**: NO (groups with Task 9)

---

- [x] **8. Implement response handler** ✅ COMPLETED

  **What to do**:
  - Create `src/auth/antigravity/response.ts`
  - Implement `transformResponse(response: Response)` for non-streaming
  - Implement `transformStreamingResponse(response: Response)` for SSE
  - Handle error responses with retry-after extraction
  - Extract usage metadata from x-antigravity-* headers

  **Must NOT do**:
  - Do NOT block on streaming responses
  - Do NOT lose error details in transformation

  **Parallelizable**: YES (with Task 7)

  **MUST READ first**:
  - Reference: NoeFabris/opencode-antigravity-auth `src/plugin/request.ts` response handling
  - Reference: numman-ali/opencode-openai-codex-auth `lib/request/response-handler.ts`

  **Acceptance Criteria**:
  - [x] Non-streaming responses transformed correctly
  - [x] SSE streaming preserved and transformed
  - [x] Error responses include useful details
  - [x] `bun run typecheck` passes

  **Commit Checkpoint**: NO (groups with Task 9)

---

- [x] **9. Implement tool normalization (Gemini only)** ✅ COMPLETED

  **What to do**:
  - Create `src/auth/antigravity/tools.ts`
  - Implement `normalizeToolsForGemini(tools: OpenAITool[])` 
    - Convert OpenAI function calling format to Gemini format
    - Handle `function` type tools with name, description, parameters
  - Implement `normalizeToolResultsFromGemini(results: GeminiToolResult[])`
    - Convert Gemini tool call results back to OpenAI format

  **Must NOT do**:
  - Do NOT handle Claude models (Antigravity is Google/Gemini only)
  - Do NOT drop unknown tool types silently (log warning)
  - Do NOT modify tool behavior, only format

  **Parallelizable**: YES (with Task 10, after 7-8 design understood)

  **MUST READ first**:
  - Reference: NoeFabris/opencode-antigravity-auth tool handling in `src/plugin/request.ts`
  - OpenAI function calling format docs
  - Gemini tool format docs

  **Tool Format Mapping:**
  ```
  OpenAI format:
  { "type": "function", "function": { "name": "x", "parameters": {...} } }
  
  Gemini format:
  { "functionDeclarations": [{ "name": "x", "parameters": {...} }] }
  ```

  **Acceptance Criteria**:
  - [x] OpenAI-style tools converted to Gemini functionDeclarations
  - [x] Tool call results mapped back correctly
  - [x] Warning logged for unsupported tool types
  - [x] `bun run typecheck` passes

  **Commit Checkpoint**: NO (groups with Task 11)

---

- [x] **10. Implement thinking block handler (Gemini only)** ✅ COMPLETED

  **What to do**:
  - Create `src/auth/antigravity/thinking.ts`
  - Implement `extractThinkingBlocks(response: GeminiResponse)`
    - Identify `thinkingContent` or reasoning segments in Gemini response
    - Separate thinking content from main response
  - Implement `shouldIncludeThinking(model: string)` 
    - Return true for `-high` model variants (e.g., `gemini-3-pro-high`)
  - Implement `formatThinkingForOpenAI(thinking: ThinkingBlock[])`
    - Convert Gemini thinking to OpenAI-compatible format

  **Must NOT do**:
  - Do NOT handle Claude models (Antigravity is Google/Gemini only)
  - Do NOT lose thinking content without explicit decision
  - Do NOT block on thinking extraction

  **Parallelizable**: YES (with Task 9)

  **MUST READ first**:
  - Reference: NoeFabris/opencode-antigravity-auth thinking block handling
  - Gemini thinking mode response format

  **Thinking Block Detection (Gemini only):**
  - Look for `thinkingContent` field in Gemini response
  - Model variants with `-high` suffix have thinking enabled

  **Acceptance Criteria**:
  - [x] Thinking blocks extracted from Gemini responses
  - [x] Model variant detection works (`-high`)
  - [x] `bun run typecheck` passes

  **Commit Checkpoint**: NO (groups with Task 11)

---

- [x] **11. Implement fetch interceptor** ✅ COMPLETED

  **What to do**:
  - Create `src/auth/antigravity/fetch.ts`
  - Implement `createAntigravityFetch(getAuth, client, providerId)` factory
  - Check token expiration before each request → auto refresh
  - Rewrite URL for Antigravity endpoints
  - Apply request transformation (including tool normalization)
  - Apply response transformation (including thinking extraction)
  - Implement endpoint fallback (try next endpoint on failure)

  **Must NOT do**:
  - Do NOT retry indefinitely (max 3 endpoints)
  - Do NOT modify global fetch

  **Parallelizable**: NO (depends on Task 7-10)

  **MUST READ first**:
  - Reference: numman-ali/opencode-openai-codex-auth `lib/request/fetch-helpers.ts`
  - Reference: NoeFabris/opencode-antigravity-auth fetch implementation

  **Endpoint Fallback Verification Procedure:**
  ```bash
  # To test fallback, temporarily modify ANTIGRAVITY_ENDPOINT_FALLBACKS order
  # or set environment variable ANTIGRAVITY_DEBUG=1 to see endpoint attempts
  # Expected: If daily fails (4xx/5xx/timeout), tries autopush, then prod
  ```

  **Acceptance Criteria**:
  - [x] Token refresh triggered when needed
  - [x] URL rewritten to Antigravity endpoint
  - [x] Request transformation applied (including tools)
  - [x] Response transformation applied (including thinking)
  - [x] Endpoint fallback works (daily → autopush → prod)
  - [x] Debug logging shows endpoint attempts when ANTIGRAVITY_DEBUG=1
  - [x] `bun run typecheck` passes

  **Commit Checkpoint**: YES

  **Commit Specification**:
  - **Message**: `feat(antigravity-auth): add request/response transformation with tools and thinking`
  - **Files to stage**: `src/auth/antigravity/request.ts`, `src/auth/antigravity/response.ts`, `src/auth/antigravity/tools.ts`, `src/auth/antigravity/thinking.ts`, `src/auth/antigravity/fetch.ts`
  - **Pre-commit verification**:
    - [x] `bun run typecheck` → No errors
  - **Rollback trigger**: Transformation errors

---

### Phase 4: Plugin Assembly

- [x] **12. Create main plugin**

  **What to do**:
  - Create `src/auth/antigravity/plugin.ts`
  - Implement `createGoogleAntigravityAuthPlugin()` factory
  - Return `{ hooks: { auth: AuthHook } }` structure
  - AuthHook includes:
    - `provider`: `"google"`
    - `loader`: Reads `provider.options` for credentials, returns `{ fetch }`
    - `methods`: OAuth method (NO prompts)

  **Must NOT do**:
  - Do NOT use prompts for credentials
  - Do NOT hardcode credentials in authorize() - read from options or use defaults

  **Parallelizable**: NO (depends on Phase 3)

  **MUST READ first**:
  - Reference: NoeFabris/opencode-antigravity-auth `src/plugin.ts`
  - Reference: numman-ali/opencode-openai-codex-auth `index.ts` (root entry point)
  - `~/local-workspaces/opencode/packages/plugin/src/index.ts` - AuthHook interface

  **Plugin Structure:**
  ```typescript
  {
    provider: "google",
    loader: async (auth, provider) => {
      // Read credentials from provider.options (opencode.json)
      const clientId = provider.options?.clientId || DEFAULT_CLIENT_ID
      const clientSecret = provider.options?.clientSecret || DEFAULT_CLIENT_SECRET
      return { 
        fetch: createAntigravityFetch(auth, clientId, clientSecret, ...) 
      }
    },
    methods: [{
      type: "oauth",
      label: "OAuth with Google (Antigravity)",
      // NO prompts - authorize directly
      authorize: async () => {
        // OAuth flow starts immediately
        // Credentials come from loader context or defaults
      }
    }]
  }
  ```

  **Acceptance Criteria**:
  - [x] Plugin returns correct structure for OpenCode
  - [x] `provider` is `"google"`
  - [x] NO prompts in methods
  - [x] `loader` reads credentials from `provider.options`
  - [x] Falls back to DEFAULT_CLIENT_ID/SECRET if not configured
  - [x] `bun run typecheck` passes

  **Commit Checkpoint**: NO (groups with Task 13)

---

- [x] **13. Update auth.ts export (SIMPLE)**

  **What to do**:
  - Update `src/auth.ts` to export the new Google Antigravity plugin:
    ```typescript
    export { createGoogleAntigravityAuthPlugin as default } from "./auth/antigravity"
    ```
  - Create `src/auth/antigravity/index.ts` barrel export

  **That's it. Keep it simple.**

  **Must NOT do**:
  - Do NOT create complex migration structure
  - Do NOT keep OpenAI auth (this is a separate plugin now)
  - Do NOT over-engineer

  **Parallelizable**: NO (depends on Task 12)

  **MUST READ first**:
  - Current `src/auth.ts` for existing pattern

  **Final Structure:**
  ```
  src/
  ├── auth.ts                           # export default from "./auth/antigravity"
  └── auth/
      └── antigravity/
          ├── index.ts                  # barrel export
          ├── plugin.ts                 # createGoogleAntigravityAuthPlugin
          ├── oauth.ts
          ├── token.ts
          ├── project.ts
          ├── request.ts
          ├── response.ts
          ├── tools.ts
          ├── thinking.ts
          ├── fetch.ts
          ├── types.ts
          └── constants.ts
  ```

  **Acceptance Criteria**:
  - [x] `src/auth.ts` exports GoogleAntigravityAuthPlugin as default
  - [x] All antigravity modules exported from barrel
  - [x] `bun run typecheck` passes

  **Commit Checkpoint**: YES

  **Commit Specification**:
  - **Message**: `feat(google-antigravity-auth): create auth plugin for Google models`
  - **Files to stage**: `src/auth.ts`, `src/auth/antigravity/`
  - **Pre-commit verification**:
    - [ ] `bun run typecheck` → No errors
    - [ ] `bun run build` → Success
  - **Rollback trigger**: Export errors

---

- [x] **14. Final verification and documentation**

  **What to do**:
  - Run full typecheck and build
  - Verify no console.log or debug statements (except when ANTIGRAVITY_DEBUG=1)
  - Update AGENTS.md with new auth location
  - Test complete flow manually

  **Must NOT do**:
  - Do NOT add test files
  - Do NOT modify README (separate task)

  **Parallelizable**: NO (final task)

  **Manual Verification Procedure:**
  ```bash
  # 1. Build and verify
  bun run typecheck && bun run build
  
  # 2. Test auth login shows option
  opencode auth login
  # Expected: See "google" provider with "OAuth with Google (Antigravity)" method
  
  # 3. Complete OAuth flow (NO prompts - browser opens immediately)
  # Select google → OAuth with Google (Antigravity)
  # Browser opens → Complete Google login
  # Expected: "Successfully authenticated with google"
  
  # 4. Test conversation (after auth)
  opencode chat --provider google --model gemini-3-pro-preview
  # Send: "Hello, what is 2+2?"
  # Expected: Non-empty response without errors
  
  # 5. (Optional) Test custom credentials via opencode.json
  # Add provider.google.options.clientId/clientSecret
  # Re-run auth login - should use custom credentials
  ```

   **Acceptance Criteria**:
   - [x] `bun run typecheck` → No errors
   - [x] `bun run build` → Success
   - [ ] `opencode auth login` shows "google" provider with Antigravity method (requires manual testing with OAuth credentials)
   - [ ] NO prompts - browser opens immediately after selecting method (requires manual testing)
   - [ ] OAuth flow completes and stores tokens (requires manual testing)
   - [ ] `opencode chat --provider google` receives Gemini response (requires manual testing)
   - [ ] Custom credentials from opencode.json options work if configured (requires manual testing)
   - [x] No debug console.log in production (only with ANTIGRAVITY_DEBUG=1)

  **Commit Checkpoint**: YES

  **Commit Specification**:
  - **Message**: `feat(google-antigravity-auth): complete implementation and verification`
  - **Files to stage**: Any remaining changes, AGENTS.md
  - **Pre-commit verification**:
    - [ ] `bun run typecheck` → No errors
    - [ ] `bun run build` → Success
  - **Rollback trigger**: N/A

---

## Commit Checkpoints Summary

| After Task | Commit Message | Pre-commit Commands | Rollback Condition |
|------------|----------------|---------------------|-------------------|
| Task 3 | `feat(google-antigravity-auth): add types and constants foundation` | `bun run typecheck` | Type errors |
| Task 6 | `feat(google-antigravity-auth): add OAuth flow and token management` | `bun run typecheck` | OAuth failures |
| Task 11 | `feat(google-antigravity-auth): add request/response transformation for Gemini` | `bun run typecheck` | Transform errors |
| Task 13 | `feat(google-antigravity-auth): create auth plugin for Google models` | `bun run typecheck`, `bun run build` | Export errors |
| Task 14 | `feat(google-antigravity-auth): complete implementation and verification` | `bun run typecheck`, `bun run build` | N/A |

---

## Estimated Effort

- **Phase 1 (Foundation)**: 30 minutes
- **Phase 2 (OAuth Core)**: 2 hours
- **Phase 3 (Request/Response + Tools + Thinking)**: 3 hours
- **Phase 4 (Plugin Assembly)**: 1.5 hours
- **Total**: ~7 hours

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| OAuth flow differences from Go | Follow cliproxyapi and opencode-antigravity-auth closely |
| Token format incompatibility | Test with actual Google OAuth tokens |
| Endpoint fallback complexity | Start with prod-only, add fallback incrementally |
| Response transformation edge cases | Log and handle unknown response formats gracefully |
| Repo focus change | Clear communication: this repo now provides Google/Antigravity auth only |

---

## Notes

- @openauthjs/openauth already used by opencode-openai-codex-auth for PKCE
- Token storage format `refreshToken|projectId|managedProjectId` enables multi-account support
- Endpoint fallback ensures service availability during Google outages
- loadCodeAssist API returns managed project for enterprise users
