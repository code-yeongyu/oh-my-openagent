# telemetry-core — Daily-Active Telemetry Primitives (Core)

**Generated:** 2026-06-17

## OVERVIEW

Harness-neutral PostHog telemetry: env-gated opt-out, SHA256-hashed machine id, once-per-UTC-day capture dedup, and JSONL diagnostics. No product-specific strings live here — each consumer passes a `TelemetryProductConfig` (event name, cache dir, machine-id prefix, env prefix). Package: `@oh-my-opencode/telemetry-core`.

## PUBLIC API (`src/index.ts` barrel)

| Module | Key exports |
|--------|-------------|
| `record-daily-active.ts` | `recordDailyActive(input)` — orchestrator: enabled? → client → dedup → `trackActive` → flush → shutdown |
| `posthog-client.ts` | `createTelemetryClient`, `isTelemetryClientEnabled`, `createDefaultPostHogTransport` |
| `activity-state.ts` | `getDailyActiveCaptureState`, `resolveTelemetryStateDir`, `getTelemetryActivityStateFilePath` |
| `env.ts` | `shouldDisableTelemetry`, `getTelemetryApiKey/Host`, `hasTelemetryApiKey` |
| `machine-id.ts` | `getTelemetryDistinctId`, `getDefaultTelemetryOsProvider` |
| `diagnostics.ts` | `writeTelemetryDiagnostic`, `cleanupTelemetryDiagnostics` |
| `constants.ts` | `DEFAULT_POSTHOG_HOST`, `DEFAULT_POSTHOG_API_KEY` |
| `types.ts` | `TelemetryProductConfig`, `TelemetryClient`, `TelemetryTransport(Factory)`, `TelemetryOsProvider`, … |

## DEPENDENCIES & CONSUMERS

- **Depends on:** `@oh-my-opencode/utils` (`writeFileAtomically`, `resolveXdgDataDir`) + `posthog-node` (^5).
- **Consumed by BOTH editions:** `omo-opencode/src/shared/posthog*.ts`; `omo-codex/src/telemetry/*` and `omo-codex/plugin/components/telemetry/*`.

## NOTES

- **At most once per UTC day per machine.** `getDailyActiveCaptureState` compares last-active UTC day in the state file; same day → `captureDaily: false`, nothing sent.
- **`$process_person_profile: false`** hardcoded on every capture — no PostHog person profiles.
- **Distinct id = `sha256(prefix + hostname)`** — never the raw hostname.
- **Opt-out env matrix:** `${PREFIX}_DISABLE_POSTHOG` (truthy `1/true/yes`) OR `${PREFIX}_SEND_ANONYMOUS_TELEMETRY` (opt-out `0/false/no/yes`); global `OMO_` prefix also checked.
- **NO_OP_CLIENT** returned when disabled or transport init fails (`enabled: false`, all methods no-op). Transport + OS provider are injectable for tests.
- **Diagnostics** JSONL: 7-day retention, 256 KB cap, cleanup on every write.
- Parent: [`packages/AGENTS.md`](../AGENTS.md).
