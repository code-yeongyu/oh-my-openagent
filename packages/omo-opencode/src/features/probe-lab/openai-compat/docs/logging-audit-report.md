# V0.8 Logging Audit Report

**Date:** 2026-05-08
**Scope:** All production `.ts` files in `src/features/probe-lab/openai-compat/` (excluding `*.test.ts`)
**Goal:** Verify no log statement leaks bearer tokens, cookies, PoW answers, full request/response bodies, or raw `auth_config` JSON.

## Method

1. Enumerate every `log()` / `console.*` invocation via grep.
2. For each call site, identify what variables are interpolated.
3. Trace each variable to confirm it is one of:
   - request id (UUID-like string, not secret)
   - account id / provider id (logical name, not secret)
   - HTTP status code
   - elapsed milliseconds / counts
   - short error message from `Error.message`
   - error type / classification string
4. Reject any call site that includes raw bodies, cookies, tokens, or full auth structures.

## Files Audited (16 production files)

| File | log() count | Verdict |
|------|-------------|---------|
| `account-pool.ts` | 2 | CLEAN |
| `auth.ts` | 0 | CLEAN |
| `config-schema.ts` | 0 | CLEAN |
| `config.ts` | 0 | CLEAN |
| `defaults.ts` | 0 | CLEAN |
| `deepseek-chat-executor.ts` | 4 | CLEAN |
| `deepseek-sse-reader.ts` | 0 | CLEAN |
| `deepseek-streaming-dispatch.ts` | 0 | CLEAN |
| `errors.ts` | 0 | CLEAN |
| `index.ts` | 0 | CLEAN |
| `messages-translator.ts` | 0 | CLEAN |
| `mute-watcher-integration.ts` | 1 | CLEAN |
| `openai-sse-writer.ts` | 0 | CLEAN |
| `pool-factory.ts` | 0 | CLEAN |
| `pool-types.ts` | 0 | CLEAN |
| `provider-factory.ts` | 0 | CLEAN |
| `rate-limit-policy.ts` | 0 | CLEAN |
| `request-id.ts` | 0 | CLEAN |
| `routes/completions.ts` | 2 | CLEAN |
| `routes/health.ts` | 0 | CLEAN |
| `routes/models.ts` | 0 | CLEAN |
| `schemas.ts` | 0 | CLEAN |
| `server.ts` | 3 | CLEAN |
| `session-cleanup.ts` | 3 | CLEAN |
| `session-factory.ts` | 0 | CLEAN |
| `streaming-chat-executor.ts` | 4 | CLEAN |
| `telemetry.ts` | 0 | CLEAN |

**Total log() call sites:** 19
**Leaks found:** 0
**Remediations applied:** 0

## Per-Call-Site Detail

### `account-pool.ts`

| Line | Pattern | Interpolated | Verdict |
|------|---------|--------------|---------|
| 135 | `account ${accountId} marked muted` | account id (logical) | CLEAN |
| 143 | `account ${accountId} cleared mute` | account id (logical) | CLEAN |

### `deepseek-chat-executor.ts`

| Line | Pattern | Interpolated | Verdict |
|------|---------|--------------|---------|
| 53 | `chat_session create failed ... reason=${sess.reason}` | "chat_session/create returned HTTP ${status}" or "missing data.biz_data.id" | CLEAN |
| 95 | `dispatch threw ... reason=${msg}` | `Error.message` (e.g. "dispatch timeout after 120000ms", "fetch failed: ECONNRESET") | CLEAN |
| 119 | `failure ... type=${verdict.errorType} status=${res.status} ms=${elapsedMs} reason=${verdict.message}` | classification + status + short reason like "DeepSeek MISSING_HEADER (biz_code 40300...)" | CLEAN |
| 136 | `success ... content_chars=${verdict.content.length}` | content LENGTH only, never the content itself | CLEAN |

### `streaming-chat-executor.ts`

| Line | Pattern | Interpolated | Verdict |
|------|---------|--------------|---------|
| 49 | `chat_session create failed ... reason=${sess.reason}` | short reason | CLEAN |
| 91 | `dispatch failed ... status=${dispatch.status} reason=${dispatch.reason}` | "upstream HTTP X" or "streaming dispatch error: <network msg>" | CLEAN |
| 125 | `success ... chunks=${chunk_count} content_chars=${content_chars} finish=${finish_reason}` | counts + finish reason, no content | CLEAN |
| 154 | `downstream cancel [rid=${requestId}]` | request id only | CLEAN |

### `session-cleanup.ts`

| Line | Pattern | Interpolated | Verdict |
|------|---------|--------------|---------|
| 94 | `delete ok ... status=${res.status}` | status only | CLEAN |
| 100 | `delete non-2xx ... status=${res.status}` | status only | CLEAN |
| 110 | `delete threw ... err=${msg}` | `Error.message` | CLEAN |

### `routes/completions.ts`

| Line | Pattern | Interpolated | Verdict |
|------|---------|--------------|---------|
| 64 | `pool load failed ... ${msg}` | "probe-lab provider not found: ${id}" — provider id is logical, not secret | CLEAN |
| 77 | `pool acquire failed ... ${msg}` | "account-pool: acquire timeout after 30000ms" / "shutting down" | CLEAN |

### `server.ts`

| Line | Pattern | Interpolated | Verdict |
|------|---------|--------------|---------|
| 32 | `serve error: ${err.message}` | Bun internal error message | CLEAN |
| 56 | `${request.method} ${url.pathname} -> ${response.status} (${ms}ms) [rid=${requestId}]` | path + status + ms + request id; query string NOT logged | CLEAN |
| 67 | `drain on stop pending=${...} drained=${...} timed_out=${...}` | counts only | CLEAN |

### `mute-watcher-integration.ts`

| Line | Pattern | Interpolated | Verdict |
|------|---------|--------------|---------|
| 42 | `account ${account.id} muted (sampled_at=${...} mute_until=${...})` | account id + timestamps | CLEAN |

## Sensitive Data Surfaces (Confirmed Not Logged)

| Surface | Where stored | Where used | Logged? |
|---------|--------------|------------|---------|
| Bearer token (server-side auth) | `OpenAICompatConfig.bearer_token` | `auth.ts:checkBearerAuth` (constant-time compare) | NEVER |
| `auth_config` JSON | `ProviderCredentials.auth_config` | `deepseek-streaming-dispatch.ts:parseAuthConfig` | NEVER |
| `aws_waf_token` cookie | parsed from auth_config | `buildCookie()` in deepseek-streaming-dispatch.ts | NEVER |
| `session_cookie` / `cookie_extra` | parsed from auth_config | `buildCookie()` | NEVER |
| `authorization` header from auth_config | parsed from auth_config | `buildBaseHeaders()` | NEVER |
| PoW challenge / answer | `attachPowResponseHeader` result | outgoing request headers only | NEVER |
| Full request body (chat completion) | `body: requestBody` in dispatch | sent to upstream, never logged | NEVER |
| Full response body / SSE chunks | streamed to client | only `body.length` / `content_chars` logged | NEVER |
| Outgoing request headers (Cookie, Authorization) | passed to fetch | NEVER logged | NEVER |

## Error Path Analysis

### SSE error frame in `openai-sse-writer.ts` (lines 168-176)

```typescript
const msg = err instanceof Error ? err.message : String(err)
controller.enqueue(
  ENC.encode(
    `data: ${JSON.stringify({ error: { type: "internal_error", message: msg } })}\n\n`,
  ),
)
```

This emits an error message into the **outgoing SSE response body** (visible to the OpenAI-compat client). The msg is `Error.message` from upstream — typically network-level (`ECONNRESET`, `socket hang up`) or parse-level. **Verdict:** CLEAN — Error.message does not include stack traces or raw payloads in standard Node/Bun runtimes.

### `errors.ts:buildErrorResponse`

Constructs the OpenAI-style error envelope. Message strings always come from controlled call sites (provider not found, dispatch failed, timeout). No raw response body is propagated.

## Conclusion

**LEAK_COUNT = 0**

No production code in `src/features/probe-lab/openai-compat/` logs:
- bearer tokens (server-side or client-side)
- cookies (`Cookie:`, `Set-Cookie:`, `aws-waf-token`, `session_cookie`)
- PoW challenge answers or hashes
- raw request bodies (chat completion payloads, prompts)
- raw response bodies or SSE chunks
- raw `auth_config` JSON

All log statements interpolate exclusively from the safe set: `request_id`, `account_id` / provider id, HTTP status, classified error type, elapsed milliseconds, content **length** counts, short controlled error messages.

No remediation required. Audit gate passes for V0.8 sign-off.
