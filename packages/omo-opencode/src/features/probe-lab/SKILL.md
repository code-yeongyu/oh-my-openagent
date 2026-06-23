---
name: probe-lab
description: Hypothesis-driven HTTP probing, replay, and falsification. Use when investigating provider behaviour, API contract drift, anti-bot challenges, or rate-limit dynamics. Tools cover provider registration, fingerprint management, replay matrices, ASPIC+ falsification, alerting, retention, and RBAC.
---

# probe-lab

probe-lab is the IDM subsystem for **hypothesis-driven HTTP probing**: register providers (10 adapter kinds covering official APIs, web-reverse adapters, and local engines), capture exchanges, replay them with structural modifications, and let ASPIC+ argumentation decide whether evidence supports, refutes, or leaves a hypothesis ambiguous. The whole pipeline is sqlite-backed (encrypted-at-rest credentials), runs alert rules over live metrics, and gates sensitive tools through RBAC + a global kill switch.

## Public tool surface

### Read-only (viewer role)

| Tool | Purpose |
|---|---|
| `probe_capture_get` | Fetch a capture file by id |
| `probe_audit_log` | Page through audit log entries |
| `probe_metrics_get` | Snapshot current ProbeMetrics |
| `probe_alerts_evaluate` | Evaluate the 9 alert rules and return triggered alerts (with 1h dedup) |
| `probe_question_*` | Add / list / status / park research questions |
| `probe_hypothesis_status` / `probe_hypothesis_add` | Inspect / add hypotheses |
| `probe_provider_health` | Check a provider's health via its adapter |
| `probe_experiment_status` | Inspect an experiment row |
| `probe_fingerprint_matrix` / `probe_fingerprint_verify` | Inspect / verify fingerprint profiles |

### Write (operator role)

| Tool | Purpose |
|---|---|
| `probe_run` | Execute an HTTP probe against a registered provider |
| `probe_replay` / `probe_replay_chain` | Replay a captured exchange (single or matrix of N modifications) |
| `probe_capture_diff` | Diff two captures structurally |
| `probe_hypothesis_evidence` | Record evidence and decide hypothesis status (ASPIC+ semantics + Piano D preferences) |
| `probe_experiment_create` / `_run` / `_abort` | Experiment lifecycle |
| `probe_canary_lock` | Lock / release / promote / demote canary identities |
| `probe_pool_burn_budget` | Track identity burn budget |
| `probe_provider_refresh` | Refresh credentials via the provider's `refreshCredentials` |
| `probe_provider_bootstrap` | Visit provider base_url via Camoufox to capture cookie-based auth (currently `aws-waf-token` for `deepseek_web`); persists captured value into `auth_config` |
| `probe_credentials_auto_rotate` | Evaluate auto-rotation triggers (expiry < 1h, 5+ consecutive 401s) |
| `probe_retention_run` | Apply retention windows (90d exchange bodies / 365d audit / 30d rate-limits / 30d captures) |

### Privileged (admin role)

| Tool | Purpose |
|---|---|
| `probe_provider_register` / `_rotate` | Register new providers; rotate api_key / proxy / fingerprint |
| `probe_fingerprint_register` | Register fingerprint profiles |
| `probe_export` | Export captures (HAR / JSONL / Markdown / OpenAPI YAML / mitmproxy / curl_replay) |
| `probe_hypothesis_supersede` / `_resurrect` | Hypothesis lifecycle transitions |

## Common workflows

### Falsify a hypothesis end-to-end

1. `probe_hypothesis_add` → declare claim + falsifiability_criteria + ASPIC+ template
2. `probe_provider_register` → register the provider you want to probe
3. `probe_run` → capture a fresh exchange under the hypothesis session
4. `probe_replay_chain` with structural modifications → matrix of variant outcomes
5. `probe_hypothesis_evidence` with `aspic_semantics: "preferred"` → decide status; multi-extension → `uncertainty_label: "high"`
6. If refuted: optionally `probe_hypothesis_supersede` with a successor

### Multi-provider comparison

1. Register N providers (`gemini_official` + `openai_official` + `anthropic_official` + …)
2. Run `probe_run` against each with the same prompt
3. `probe_capture_diff` between captures, or `probe_export format=markdown_report`

### AWS WAF target (DeepSeek web)

1. Register provider with `provider_type: deepseek_web`, `auth_config.aws_waf_token`
2. `probe_provider_health` → confirms `aws-waf-token` cookie roundtrip
3. `probe_run` dispatches via curl_cffi for TLS impersonation
4. On 200+WAF challenge body → `ProbeError.kind = captcha`; rotate via `probe_provider_rotate rotation_type=credentials`

## Configuration keys (`probe_lab_config` table)

| Key | Purpose | Default |
|---|---|---|
| `global_kill_switch` | "1" → block probe_run / probe_replay / experiment_run | unset |
| `current_role` | RBAC role: viewer \| operator \| admin | admin |
| `retention_last_run_at` | Last successful retention sweep epoch | unset |
| `webhook_alerts_url` | (future) URL for webhook notifier | unset |

## Environment variables

| Variable | Purpose |
|---|---|
| `IDM_PROBE_LAB_MASTER_KEY` | 32-byte hex AES-256-GCM key for credential encryption at rest |
| `IDM_PROBE_LAB_CAMOUFOX_AUTO` | Set to `1` to lazy-auto-register the bundled Camoufox driver on first dispatch. Default unset → `dispatchReplay` for the camoufox engine throws "production driver registration required" (operator must call `__setCamoufoxDriverForTest(driver)` manually). |
| `IDM_PROBE_LAB_CURL_CFFI_AUTO` | Set to `1` to lazy-auto-register the bundled curl_cffi driver on first dispatch. Requires `cycletls` to be installed as a peer dependency in the host project (see "Production driver wiring" below). |
| `PROBE_LAB_LIVE_HTTP` | Set to `1` to run the live HTTP E2E driver tests against `tls.peet.ws` and `example.com`. Default unset → those tests are skipped. CI safe. |

## Engines

`probe_replay` and the `claude_web_reverse` / `gemini_web_reverse` / `deepseek_web` adapters dispatch through `replay-engine-dispatcher.ts`. Engines `bun_fetch` (default), `camoufox`, and `curl_cffi` are wired via driver shims with test seams `__setCamoufoxDriverForTest` / `__setCurlCffiDriverForTest`. Engines `nodriver`, `go_utls`, `custom` return a deferred error.

## Production driver wiring (v1.1)

v1.1 ships **bundled production drivers** for both `camoufox` and `curl_cffi`. Activation is operator-side via env vars (default off — preserves the v1.0 "production driver registration required" error path so tests cannot silently spawn browsers or HTTP servers).

| Engine | Driver file | Activation | Peer dependency |
|---|---|---|---|
| `camoufox` | `replay-engine-camoufox-driver.ts` | `IDM_PROBE_LAB_CAMOUFOX_AUTO=1` | `camoufox-js` (already in `idm` deps) — Camoufox binary downloaded automatically by `camoufox-js` on first launch |
| `curl_cffi` | `replay-engine-curl-cffi-driver.ts` (uses **CycleTLS**, not Python `curl_cffi`) | `IDM_PROBE_LAB_CURL_CFFI_AUTO=1` | `cycletls` — operator must install in host project: `bun add cycletls` |

### Why CycleTLS instead of Python curl_cffi?

We pivoted from `node-curl-impersonate` (and never considered Python curl_cffi) for these reasons:
- `node-curl-impersonate@1.5.4` ships subprocess wrappers with **only `darwin-x86` binaries** (no `darwin-arm64` for Apple Silicon) and only chrome-110 / chrome-116 / firefox-109 / firefox-117 presets — no chrome-146.
- A pure-TS path keeps probe-lab Bun-only (no Python subprocess), preserving the "TS only, no Python" architecture rule.
- `cycletls@2.0.5` ships native binaries for darwin-arm64, darwin-x64, linux-x64/arm/arm64, freebsd, win32. Supports JA3, JA4R, HTTP/2 fingerprint, QUIC fingerprint, custom UA + headerOrder.

Smoke-tested against `https://tls.peet.ws/api/all` with chrome-146 JA3 string: returned `ja3_hash=c1f346602fd70fbabcf22dc417a7ca35`, `ja4=t12d1715h2_5b57614c22b0_4d8a99c1bc01`, status 200.

### Camoufox driver semantics

The Camoufox driver uses `playwright-core`'s `BrowserContext.request.fetch(url, { method, headers, data })` for full HTTP control inside the browser context, including cookie jar reuse across requests. This means:
- All standard HTTP methods (GET, POST, PUT, DELETE, PATCH, HEAD) are supported.
- Cookies set via prior `probe_provider_bootstrap` (or by the page itself during navigation) are sent automatically.
- A singleton browser pool (`maxConcurrent: 3`, `idleTimeoutMs: 120s`) is lazy-created on first dispatch and shut down via `shutdownCamoufoxDriver()` on test cleanup.

### curl_cffi driver semantics

The curl_cffi driver wraps CycleTLS:
- Default impersonation: chrome-146 JA3 + UA (`createCurlCffiDriver()`). Override via `createCurlCffiDriver({ ja3, userAgent })`.
- Singleton CycleTLS instance (random port 30000–35000, 30s timeout) is lazy-initialized on first dispatch and shut down via `shutdownCurlCffiDriver()`.
- Headers, body, method are forwarded as-is.
- Response `data` (JSON-decoded by CycleTLS when content-type is JSON) is re-stringified into `body` for `ReplayResult` consistency with `bun_fetch` / `camoufox` / mock drivers.

### Disabling auto-registration / manual driver injection

If neither env var is set, the v1.0 behavior is preserved exactly: `dispatchReplay` throws `engine '<name>' requires a production driver registration. v1.0 ships the adapter shell + mock-test seam; production driver wiring is operator-side. Register a driver via __setCamoufoxDriverForTest() at runtime ...`. Tests reset both via `afterEach(() => { __setCamoufoxDriverForTest(null); __setCurlCffiDriverForTest(null) })`.

The `__set*ForTest` setters remain the intended runtime registration mechanism — env-var auto-registration is only a convenience layer that calls them internally on first dispatch.

### DeepSeek bootstrap end-to-end

For `deepseek_web` providers behind AWS WAF:

1. `probe_provider_register provider_type=deepseek_web base_url=https://chat.deepseek.com auth_type=cookie_session auth_config={}`
2. `probe_provider_bootstrap provider_id=<id>` — Camoufox visits the base URL, waits for the AWS WAF JS challenge to clear (Camoufox is a real browser so the challenge solves itself), reads cookies, persists `aws-waf-token` into `auth_config`.
3. With `IDM_PROBE_LAB_CURL_CFFI_AUTO=1`, `probe_run` against the provider now uses curl_cffi with the captured cookie + chrome-146 JA3.
4. When `aws-waf-token` rotates, re-run `probe_provider_bootstrap` (or `probe_provider_refresh refresh_type=aws_waf_token` for the synthetic-token path that returns a placeholder).
