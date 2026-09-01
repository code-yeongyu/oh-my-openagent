# src/telemetry — CLI-side telemetry (source of truth)

**Score 8** (17 files, ~1.5k LOC; distinct domain: install/CLI-side half of the telemetry pair).

## OVERVIEW

CLI/install-side half of the daily-active telemetry. `index.ts` barrel re-exports the full API (consumed by the installer and `src/index.ts`). The plugin-side half lives at `plugin/components/telemetry/`; the two must stay in lockstep — constants byte-equivalent, pinned by `cross-package-equivalence.test.ts`. Event identity, dedup, and opt-out flags are owned by the package AGENTS.md TELEMETRY section.

## WHERE TO LOOK

| File | Role |
|------|------|
| `posthog.ts` | Client construction/capture/shutdown; the silent-failure contract |
| `product-identity.ts` | Product/event/env-prefix constants — the equivalence-pinned bytes |
| `posthog-activity-state.ts` | UTC-day dedup state |
| `data-path.ts` | Data dir + activity state dir resolution |
| `env-flags.ts` | Opt-out/disable env readers |
| `diagnostics.ts` | Local JSONL diagnostics (256 KiB cap, `writeTelemetryDiagnostic`/`cleanupTelemetryDiagnostics`) |
| `atomic-write.ts` | Temp+rename write primitive |

## CONVENTIONS

- Test seams are explicit `__set*ForTesting` / `__reset*ForTesting` / `__create*ForTesting` functions. Use them; do not monkey-patch.
- Every failure path silent: exit 0, empty stdout, even when PostHog construction/capture/shutdown throws.
- A new event type requires a new dedup state slot; never remove existing dedup.

## ANTI-PATTERNS

- No prompts, file contents, raw hostnames, API keys, or identifying data into events.
- Do not let constants drift from `plugin/components/telemetry/src/product-identity.ts` — the equivalence test fails the build.

## COMMANDS

- `bun test packages/omo-codex/src/telemetry`
- Equivalence gate: `bun test packages/omo-codex/src/telemetry/cross-package-equivalence.test.ts`
