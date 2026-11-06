# telemetry-core — Daily-Active Telemetry Primitives (Core)

**Generated:** 2026-08-24

## OVERVIEW

Harness-neutral PostHog telemetry: env-gated opt-out, SHA256-hashed random install id, once-per-UTC-day capture dedup, and JSONL diagnostics. No product-specific strings live here — each consumer passes a `TelemetryProductConfig` (event name, cache dir, env prefix). Package: `@oh-my-opencode/telemetry-core`.

## PUBLIC API (`src/index.ts` barrel)

| Module | Key exports |
|--------|-------------|
| `record-daily-active.ts` | `recordDailyActive(input)` — orchestrator: enabled? → client → dedup → `trackActive` → flush → shutdown |
| `posthog-client.ts` | `createTelemetryClient`, `isTelemetryClientEnabled`, `createDefaultPostHogTransport`, `TelemetryDeliveryError` (`telemetry-delivery-error.ts`; `permanent` marks 400/413). The transport's `captureImmediate` resolves only on a 2xx answer and rejects with it otherwise; its sender (`posthog-immediate-send.ts`, given the PostHog class by the caller) is loaded on the first immediate send through the package import `#telemetry-immediate-send`, which bundlers inline and the senpi plugin maps to its telemetry sidecar; a failed load is retried by the next send. The package subpath `@oh-my-opencode/telemetry-core/immediate-send` exposes the same module (the sender plus `TelemetryDeliveryError`), so the sidecar takes it without the barrel and without posthog-node's top-level code |
| `activity-state.ts` | `getDailyActiveCaptureState`, `resolveTelemetryStateDir`, `getTelemetryActivityStateFilePath` |
| `env.ts` | `shouldDisableTelemetry`, `getTelemetryApiKey/Host`, `hasTelemetryApiKey` |
| `machine-id.ts` | `getDefaultTelemetryOsProvider` (OS metadata for shared properties; never an identity) |
| `install-id.ts` | `getTelemetryInstallDistinctId(stateDir)`: sha256 of a random 64-hex `install-id` file (0600) created on first send in the product's state dir |
| `events.ts` | `createEventTelemetryClient` — typed event capture wrapper (see NOTES) + `EventTelemetryClient`, `EventPropertyAllowlist`, `CreateEventTelemetryClientInput`, … |
| `diagnostics.ts` | `writeTelemetryDiagnostic`, `cleanupTelemetryDiagnostics` |
| `consent-gated-fetch.ts` | `createConsentGatedFetch` — the PostHog `fetch` option gated on consent at send time; every SDK flush (interval, batch size, shutdown) goes through it, and a dropped batch answers 200 so it leaves the queue unsent |
| `constants.ts` | `DEFAULT_POSTHOG_HOST`, `DEFAULT_POSTHOG_API_KEY` |
| `types.ts` | `TelemetryProductConfig`, `TelemetryClient`, `TelemetryTransport(Factory)` (optional `traces: TurnTracing` on a transport with a span sink), `TelemetryOsProvider`, … |
| `turn-trace-bridge.ts` | `publishTurnTraceparent` / `readTurnTraceparent` / `clearTurnTraceparent` / `isTraceparent`: a process-wide (`globalThis` symbol) map raw session id -> current turn traceparent, so the task engine bundle can hand the delegating turn's context to a process child. Dependency-free. |

## OPENTELEMETRY HOST (`@oh-my-opencode/telemetry-core/otlp` subpath, NOT in the main barrel)

The collector transport (telemetry-collector plan, todo 21). Kept off the main barrel so PostHog-only consumers never load the OTLP code. Nothing wires it yet (todo 22 adds `telemetry.sink`).

| Module | Role |
|--------|------|
| `otel-minimal-logs.ts` / `otel-minimal-trace.ts` / `otel-time.ts` | Minimal in-house `LoggerProvider`/`TracerProvider` behind `@opentelemetry/api` + `api-logs` (spike 13 (g) fallback: the stock SDK missed the startup budget). `telemetry.sdk.name = omo-otel-minimal`. AlwaysOn sampling (never ParentBased); span events, links, exception text and status messages are never recorded. Reads no `OTEL_*` variable. |
| `otel-providers.ts` | `createTelemetryProviders()`: one WAL processor per signal; registers only the AsyncLocalStorage context manager and the W3C propagator globally, never a provider. `getActiveTraceContext()`. |
| `otel-turn-span.ts` | `createTurnTracing()` -> `transport.traces.startTurn()`: one `omo.turn` span (INTERNAL, AlwaysOn) per assistant turn; `run(fn)` makes it active so every event emitted inside carries its trace/span ids; `end("ok"|"error")`. Parent = a valid inherited `traceparent` (task bridge) else the active context; an unsampled `-00` parent still records. Undefined while consent is off or after shutdown, so no span exists when telemetry is disabled; the PostHog transport has no `traces`. |
| `otel-traceparent-fetch.ts` | `createTraceparentFetch(fetch, hosts)`: injects the active span's `traceparent` only for exact hosts in the allowlist (`OMO_TRACE_HOSTS` = `t.omo.dev`, `api.omo.dev`, plus the transport's own endpoint host); model-provider hosts never receive it. The OTLP sender sends through it. |
| `otlp-inspect.ts` | `inspectOtlpRequest(signal, body)`: decodes one OTLP protobuf request into plain records with hex ids (QA sinks, tests). |
| `otel-resource.ts` | `createTelemetryResource()`: the D-P Resource (`service.*`, `os.type` win32->windows, `host.arch` x64->amd64, `omo.*`). |
| `otlp-wal.ts` | `SpoolWriter` + `WalLogRecordProcessor`/`WalSpanProcessor`: each record is appended synchronously (no fsync) as a length-prefixed OTLP frame to `active-<signal>-<pid>-<boot_id>.otlp` BEFORE anything is queued. File and dir are created on the first consented append only. |
| `otlp-spool-file.ts` | Spool format: header frame `[format=1][signal]` + ResourceLogs/ResourceSpans (Resource + Scope); `readSpoolRequest()` builds the one Export*ServiceRequest per file from the FILE's header. Torn tail frames are ignored. |
| `otlp-spool-dir.ts` | Seal (`batch-<signal>-<uuidv7>.otlp`), rename-based claims (`.sending-<boot_id>-<lease_ms>`, 5 min lease), sweep (expired leases, dead-owner active files idle >= 5 min, 14-day expiry by batch id), quarantine. Owner-only moves (seal, claim release) are hard link + unlink (a crash leftover second link is swept); every competing move (claim, renewal, lease reclaim, dead-owner seal) is a rename under the file's O_EXCL `<name>.lock` (`otlp-spool-lock.ts`), because a rename alone does not pick one winner on Windows. Each lock holds its owner's token (`<pid> <boot id> <nonce>`); a mover re-checks its token right before the rename and deletes only its own lock, so a lock the sweep or the purge removed under it never lets a second mover in. The sweep deletes a lock older than the lease once its owner pid is dead (or the token is unreadable), and any lock past the spool's age limit. Every throw in a move leaves the spool consistent: a failed move is rolled back to one copy under the source name, a lock that cannot be deleted is reported (`telemetry_spool_write_failed`) instead of replacing the move's result, and the pump and the lease-renewal timer report errors instead of rejecting. |
| `otlp-spool-cap.ts` | 5 MB cap with oldest-first eviction; caches sealed-batch sizes and lists the directory only when last scan + bytes sealed since could pass the cap. The periodic sweep runs a full scan (`enforce()`), so files other processes left are capped too. |
| `otlp-http.ts` | One POST per file: protobuf, gzip > 8 KB, `X-OmO-Ingest-Key`, 256 KB cap; retry 429/502/503/504/network with 1,2,4,8,16 s + jitter (Retry-After wins, cap 60 s); 400/401/413 never retried; 2xx incl. partial_success settles. |
| `otlp-entry.ts` | The `./otlp` subpath. `createOtlpTelemetryTransport()` (async) reads every opt-out, `OTEL_SDK_DISABLED=true` and `consent()` with no OpenTelemetry or protobuf code loaded; disabled -> purges the spool (`otlp-spool-purge` + `otlp-spool-names`, node:fs only) and returns null; enabled -> `await import("./otlp-sender")`. It is the ONLY public OTLP subpath, so nothing outside the package can reach `createOtlpSender` or `createTelemetryProviders` around the opt-out gate and the per-event allowlist. |
| `otlp-gate.ts` / `otlp-sender.ts` | `isOtlpTransportAllowed()`: every opt-out + `consent()` (a throwing callback = no consent, `telemetry_consent_failed`). `startOtlpTransport()` (async) is the runtime's only starter: it runs that check itself and returns null before any OpenTelemetry, protobuf or spool code loads, then imports `otlp-sender-core`. |
| `otlp-batch-sender.ts` / `otlp-sender-core.ts` | `createOtlpSender()` (reached only through `startOtlpTransport`; tests drive it directly): a `TelemetryTransport` whose only direct API is `tracer`; `project` (per-event allowlist, also the source of `session.id`) and `spans` (span name -> allowed attribute keys) are required; seals at 20 records or 10 s, `omo.client_dropped` at the next flush, `droppedEvents()` since the last 200, `sampling.rawTurnRate = 1`, 2 s shutdown cap, `consent()` checked before every append and send. `OMO_TELEMETRY_ENDPOINT` overrides; `OTEL_EXPORTER_OTLP_*` is ignored. Spool lifecycle (todo 31): on start and every 60 s (`scheduleEvery`, unref'd by default) the sweep tick recovers expired claims and dead owners, enforces the cap and replays, or purges when consent ended; before every attempt the sender renames its claim to a fresh lease, so a stalled claimer whose batch was reclaimed never sends it (`lost`), and withdrawn consent deletes the claimed batch unsent (`withdrawn`). |
| `otlp-proto/` | Generated code from opentelemetry-proto `v1.7.0`, vendored byte-identical from the collector repo (`SHA256SUMS` pinned by a test). Never edit by hand. |

## DEPENDENCIES & CONSUMERS

- **Depends on:** `@oh-my-opencode/utils` (`writeFileAtomically`, `resolveXdgDataDir`) + `posthog-node` (^5). The OTLP subpath adds exact pins `@opentelemetry/api` 1.9.1, `api-logs` 0.223.0, `context-async-hooks` 2.12.0, `core` 2.12.0 and `@bufbuild/protobuf` 2.16.0 (upgrades go through the collector's conformance fixtures, never renovate).
- **Consumed by BOTH editions:** `omo-opencode/src/shared/posthog*.ts`; `omo-codex/src/telemetry/*` and `omo-codex/plugin/components/telemetry/*`.

## NOTES

- The `./injected` entry exposes SDK-free clients and daily-active recording with a required `transportFactory`; the default root exports remain synchronous wrappers around the same implementations. `posthog-transport.ts` owns the SDK import and is exposed as `./posthog-transport` for lazy sidecar entries. Keep the subpath declaration files aligned with the root's maintained public types.

- **At most once per UTC day per machine.** `getDailyActiveCaptureState` compares last-active UTC day in the state file; same day → `captureDaily: false`, nothing sent.
- **`$process_person_profile: false`** hardcoded on every capture — no PostHog person profiles.
- **Distinct id = `sha256(install id)`**, a random id created lazily on the send path (after every consent check). No identifier is derived from the hostname, user name, home path or any machine attribute.
- **Opt-out env matrix:** `${PREFIX}_DISABLE_POSTHOG` (truthy `1/true/yes`) OR `${PREFIX}_SEND_ANONYMOUS_TELEMETRY` (opt-out `0/false/no/yes`); global `OMO_` prefix also checked; plus the standard unprefixed `DO_NOT_TRACK`.
- **NO_OP_CLIENT** returned when disabled or transport init fails (`enabled: false`, all methods no-op). Transport + OS provider are injectable for tests.
- **Diagnostics** JSONL: 7-day retention, 256 KB cap, cleanup on every write.
- **`createEventTelemetryClient`** (events.ts) — event telemetry with a per-product `propertyAllowlist`: unknown properties are DROPPED with diagnostics, never sent. Hard-rejected keys: `$ip`, non-allowlisted `$` keys (only `$os`, `$os_version`, `$process_person_profile`, `$session_id` pass), `*_text|*_path|*_prompt` suffixes (allowlisted non-string flags excepted), and non-finite numbers. Batching overrides (`flushAt: 20`, `flushInterval: 10s`) are applied LAST so a product config cannot weaken them. `disableGeoip: false` lets PostHog derive `$geoip_country_code` server-side from the transport IP — the client still never authors/stores an IP. No-op client when disabled, same as the daily-active path.
- Parent: [`packages/AGENTS.md`](../AGENTS.md).
