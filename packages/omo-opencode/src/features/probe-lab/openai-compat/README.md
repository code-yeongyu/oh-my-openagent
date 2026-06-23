# probe-lab openai-compat adapter

Stateless OpenAI-compatible HTTP server for `chat.deepseek.com`. Translates `/v1/chat/completions` (and `/v1/models`, `/health`) calls into DeepSeek web `/api/v0/chat/completion` SSE flows. Implements bearer-token auth, multi-account pooling, conservative rate limiting calibrated from the V0.3 live runs, and stream/non-stream variants of completion.

## Architecture (V0.4 → V0.8)

```
client
  │  Bearer ${bearer_token}
  ▼
Bun.serve (server.ts)
  │
  ├── /health                         → routes/health.ts
  ├── /v1/models    GET              → routes/models.ts
  └── /v1/chat/completions  POST     → routes/completions.ts
                                          │
                                          │ acquire account from pool (account-pool.ts)
                                          │ – round-robin
                                          │ – rate-limit-policy.ts (BURST_INFLIGHT_CAP=2, sustained-rpm=10)
                                          │ – mute / cooldown / unmute (mute-watcher-integration.ts)
                                          │
                                          ├── stream:false → deepseek-chat-executor.ts (V0.5)
                                          │   ├── createChatSession
                                          │   ├── dispatchProbe (timeout-bounded race)
                                          │   ├── extract SSE signals (cif-threshold-signal-extractor)
                                          │   ├── classify success / empty_sse / truncated_stream / etc.
                                          │   └── enqueueSessionDelete (fire-and-forget cleanup)
                                          │
                                          └── stream:true  → streaming-chat-executor.ts (V0.6)
                                              ├── createChatSession
                                              ├── dispatchStreamingCompletion (fetch → ReadableStream)
                                              ├── parseSseStream (DeepSeek SSE → SseEvent iterable)
                                              ├── buildOpenAIStream (OpenAI chat.completion.chunk SSE)
                                              ├── onComplete → telemetry + enqueueSessionDelete (only on FINISHED)
                                              └── onCancel  → upstream signal abort
```

| Version | Capability |
|---------|------------|
| V0.1 | OpenAICompatConfig schema, defaults, errors envelope |
| V0.2 | Live HTTP smoke (single sequential dispatch) |
| V0.3 | Phase 2C calibration: ≥12 rpm sustained; burst headroom of 3 with truncation risk; 50k-char ceiling observed |
| V0.4 | Server skeleton: routes, auth, request-id, models endpoint |
| V0.5 | Stateless single-call executor (stream:false), classification, telemetry |
| V0.6 | Streaming executor (stream:true), DeepSeek SSE → OpenAI SSE writer, downstream cancel propagation |
| V0.7 | Multi-account pool: round-robin, rate-limit policy, mute watcher, pool factory + provider factory |
| V0.8 | Hardening: idempotent release, timeout/connection_reset telemetry, shutdown drain, V0.5 timeout race, README, audit |

## Configuration

### Server config (Zod-validated)

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| `bearer_token` | yes | — | Inbound bearer; checked constant-time |
| `host` | no | `127.0.0.1` | Loopback by default for safety |
| `port` | no | `0` (= dynamic from 38000) | Port `0` triggers `findAvailablePort` |
| `version` | no | adapter version | Reflected in `/health` |

### Provider selection (env)

| Env var | Purpose |
|---------|---------|
| `IDM_OPENAI_COMPAT_PROVIDER_IDS` | Comma-separated list of probe-lab provider ids (deepseek_web). Preferred. |
| `IDM_OPENAI_COMPAT_PROVIDER_ID` | Legacy singular form. Resolves to a pool of one. Still subject to `BURST_INFLIGHT_CAP_PER_ACCOUNT=2`. |

When neither is set, defaults to `["deepseek-web"]`.

### Rate-limit defaults (`defaults.ts:RATE_DEFAULTS`)

| Constant | Value | Source |
|----------|-------|--------|
| `SUSTAINED_RPM_PER_ACCOUNT` | 10 | V0.3 calibration (clean ≥12 rpm; conservative floor) |
| `BURST_INFLIGHT_CAP_PER_ACCOUNT` | 2 | Oracle gate (Junior 3 → Oracle 2) |
| `BURST_EXPERIMENTAL_CAP` | 3 | Canary only; truncation triggers backoff |
| `POOL_SIZE_FOR_60_RPM_AGGREGATE` | 9 | `ceil(60/10) * 1.5` |
| `COOLDOWN_AFTER_BURST_MS` | 10_000 | After burst / truncation event |
| `MUTE_WATCHER_NORMAL_MS` | 30_000 | Routine polling |

## Quickstart

1. Register at least one `deepseek_web` provider via `probe_provider_register` (see `probe-lab` MCP).
2. Bootstrap the AWS WAF cookie via `probe_provider_bootstrap` and ensure `auto_solve_pow=true` in `auth_config`.
3. Set env: `IDM_OPENAI_COMPAT_PROVIDER_IDS=ds-1,ds-2,...` (or singular for one).
4. Start the server programmatically:

   ```ts
   import { createOpenAICompatServer } from "./openai-compat"

   const srv = await createOpenAICompatServer({
     bearer_token: process.env.LOCAL_BEARER ?? "secret",
     host: "127.0.0.1",
     port: 0,
     version: "v0.8",
   })
   console.log(srv.url) // http://127.0.0.1:<port>
   ```

5. Point an OpenAI client at it:

   ```bash
   curl -sN "$URL/v1/chat/completions" \
     -H "Authorization: Bearer $LOCAL_BEARER" \
     -H "Content-Type: application/json" \
     -d '{"model":"deepseek-chat","stream":true,"messages":[{"role":"user","content":"hi"}]}'
   ```

## Telemetry

Per-account counters tracked via `getGlobalTelemetry()`:

| Class | Triggered by |
|-------|--------------|
| `success` | FINISHED SSE with content |
| `http_429` | upstream 429 |
| `http_4xx` | upstream 4xx (incl. 401/403/405) |
| `missing_header` | DeepSeek `biz_code 40300` (cookie / PoW issue) |
| `empty_sse` | HTTP 200 + zero SSE events (rate-limit signal) |
| `truncated_stream` | HTTP 200 + SSE without FINISHED (V0.3 finding) |
| `mute_observed` | mute watcher flipped account into muted state |
| `timeout` | dispatch wall time exceeded `dispatchTimeoutMs` |
| `connection_reset` | `ECONNRESET`, `socket hang up`, `stream errored` from upstream |

Snapshot exposes: per-account counters + ring buffer of last 1000 events.

## Known Limitations

- **stream:true uses vanilla `fetch`**: TLS fingerprint is whatever Bun's runtime negotiates, not Chrome-impersonated. PoW header is still computed, but JA3/JA4 differs from real Chrome.
- **No `/metrics` endpoint**: Telemetry is in-process only. Scrape via `getGlobalTelemetry().snapshot()`. (Out of scope; potential V0.9.)
- **Fire-and-forget chat_session cleanup**: `enqueueSessionDelete` returns synchronously and runs on `queueMicrotask`. On shutdown, `server.stop()` calls `drainSessionDeletes(5000ms)` to wait for in-flight deletes; tasks not yet drained are abandoned with a log line.
- **Singular `IDM_OPENAI_COMPAT_PROVIDER_ID` is legacy**: Resolves to a pool of one. Burst cap (2 inflight) still applies. Prefer the plural form for clarity.
- **No tool / function calling**: Requests with `role: "tool"` or `role: "function"` rejected with 400.

## Phase 2C Calibration Credit (V0.3)

Run `cal-1778194819085-zmdu62` on `odapek4838@aula.edu.pl` (2026-05-07, 27/40 probes, 6.83 min) found:

- safe sustained rate ≥ 12 rpm at concurrency 1 (zero mutes across 5/8/12 ramps)
- reliable burst headroom = 3 inflight per account
- canary `c=5` produced 3/5 truncated streams (HTTP 200 + `terminal_status=null` + `total_ms < 600`) — gave rise to the `truncated_stream` signal class
- token ceiling ≥ 50_000 characters per request
- proof-of-work + AWS WAF cookie required for every completion (handled by `deepseek-web-pow-handler`)

These observations seeded the conservative defaults: SUSTAINED_RPM=10, BURST_INFLIGHT_CAP=2, COOLDOWN_AFTER_BURST_MS=10_000.

## File Map

| Concern | Files |
|---------|-------|
| Server / routing | `server.ts`, `routes/{health,models,completions}.ts` |
| Auth | `auth.ts`, `errors.ts`, `request-id.ts` |
| Schemas | `config-schema.ts`, `schemas.ts`, `defaults.ts` |
| Provider load | `provider-factory.ts`, `pool-factory.ts`, `pool-types.ts` |
| Pool runtime | `account-pool.ts`, `rate-limit-policy.ts`, `mute-watcher-integration.ts` |
| Stream:false | `deepseek-chat-executor.ts`, `session-factory.ts`, `messages-translator.ts` |
| Stream:true | `streaming-chat-executor.ts`, `deepseek-streaming-dispatch.ts`, `deepseek-sse-reader.ts`, `openai-sse-writer.ts` |
| Cleanup | `session-cleanup.ts` |
| Telemetry | `telemetry.ts` |
| Module barrel | `index.ts` |
| Docs | `README.md`, `docs/logging-audit-report.md` |
