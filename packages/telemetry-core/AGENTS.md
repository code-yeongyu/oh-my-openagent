# telemetry-core — Daily-Active Telemetry Primitives (Core)

**Generated:** 2026-08-24

## OVERVIEW

Harness-neutral PostHog telemetry: env-gated opt-out, SHA256-hashed machine id, once-per-UTC-day capture dedup, and JSONL diagnostics. No product-specific strings live here — each consumer passes a `TelemetryProductConfig` (event name, cache dir, machine-id prefix, env prefix). Package: `@oh-my-opencode/telemetry-core`.

## PUBLIC API (`src/index.ts` barrel)

| Module | Key exports |
|--------|-------------|
| `record-daily-active.ts` | `recordDailyActive(input)` — orchestrator: enabled? → client → dedup → `trackActive` → flush → shutdown |
| `posthog-client.ts` | `createTelemetryClient`, `isTelemetryClientEnabled`, `createDefaultPostHogTransport`, `TelemetryDeliveryError` (`telemetry-delivery-error.ts`; `permanent` marks 400/413). The transport's `captureImmediate` resolves only on a 2xx answer and rejects with it otherwise; its sender (`posthog-immediate-send.ts`, given the PostHog class by the caller) is loaded on the first immediate send through the package import `#telemetry-immediate-send`, which bundlers inline and the senpi plugin maps to its telemetry sidecar; a failed load is retried by the next send. The package subpath `@oh-my-opencode/telemetry-core/immediate-send` exposes the same module (the sender plus `TelemetryDeliveryError`), so the sidecar takes it without the barrel and without posthog-node's top-level code |
| `activity-state.ts` | `getDailyActiveCaptureState`, `resolveTelemetryStateDir`, `getTelemetryActivityStateFilePath` |
| `env.ts` | `shouldDisableTelemetry`, `getTelemetryApiKey/Host`, `hasTelemetryApiKey` |
| `machine-id.ts` | `getTelemetryDistinctId`, `getDefaultTelemetryOsProvider` |
| `events.ts` | `createEventTelemetryClient` — typed event capture wrapper (see NOTES) + `EventTelemetryClient`, `EventPropertyAllowlist`, `CreateEventTelemetryClientInput`, … |
| `diagnostics.ts` | `writeTelemetryDiagnostic`, `cleanupTelemetryDiagnostics` |
| `consent-gated-fetch.ts` | `createConsentGatedFetch` — the PostHog `fetch` option gated on consent at send time; every SDK flush (interval, batch size, shutdown) goes through it, and a dropped batch answers 200 so it leaves the queue unsent |
| `constants.ts` | `DEFAULT_POSTHOG_HOST`, `DEFAULT_POSTHOG_API_KEY` |
| `types.ts` | `TelemetryProductConfig`, `TelemetryClient`, `TelemetryTransport(Factory)`, `TelemetryOsProvider`, … |

## DEPENDENCIES & CONSUMERS

- **Depends on:** `@oh-my-opencode/utils` (`writeFileAtomically`, `resolveXdgDataDir`) + `posthog-node` (^5).
- **Consumed by BOTH editions:** `omo-opencode/src/shared/posthog*.ts`; `omo-codex/src/telemetry/*` and `omo-codex/plugin/components/telemetry/*`.

## NOTES

- **At most once per UTC day per machine.** `getDailyActiveCaptureState` compares last-active UTC day in the state file; same day → `captureDaily: false`, nothing sent.
- **`$process_person_profile: false`** hardcoded on every capture — no PostHog person profiles.
- **Distinct id = `sha256(prefix + hostname)`** — never the raw hostname.
- **Opt-out env matrix:** `${PREFIX}_DISABLE_POSTHOG` (truthy `1/true/yes`) OR `${PREFIX}_SEND_ANONYMOUS_TELEMETRY` (opt-out `0/false/no/yes`); global `OMO_` prefix also checked; plus the standard unprefixed `DO_NOT_TRACK`.
- **NO_OP_CLIENT** returned when disabled or transport init fails (`enabled: false`, all methods no-op). Transport + OS provider are injectable for tests.
- **Diagnostics** JSONL: 7-day retention, 256 KB cap, cleanup on every write.
- **`createEventTelemetryClient`** (events.ts) — event telemetry with a per-product `propertyAllowlist`: unknown properties are DROPPED with diagnostics, never sent. Hard-rejected keys: `$ip`, non-allowlisted `$` keys (only `$os`, `$os_version`, `$process_person_profile`, `$session_id` pass), `*_text|*_path|*_prompt` suffixes (allowlisted non-string flags excepted), and non-finite numbers. Batching overrides (`flushAt: 20`, `flushInterval: 10s`) are applied LAST so a product config cannot weaken them. `disableGeoip: false` lets PostHog derive `$geoip_country_code` server-side from the transport IP — the client still never authors/stores an IP. No-op client when disabled, same as the daily-active path.
- Parent: [`packages/AGENTS.md`](../AGENTS.md).
