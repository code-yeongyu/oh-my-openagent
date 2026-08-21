# telemetry component

Senpi telemetry adapter over `@oh-my-opencode/telemetry-core` PostHog primitives. Two products share this directory: the legacy `omo-senpi` daily-active ping (`index.ts`) and the richer `omo-native` event family (everything `omo-native-*`). Both are anonymous, best-effort, and must never block or crash the host.

## Anatomy

| Path | Purpose |
|------|---------|
| `index.ts` | Legacy daily-active: fires `omo_senpi_daily_active` on `session_start`, once per UTC day per machine, hard `withTimeout` cap at 500 ms (`DEFAULT_TIMEOUT_MS`), failures logged at debug only. State under `<agent-home>/omo-senpi/posthog`. |
| `product-identity.ts` | `omo-native` product config, PostHog write key constant, `KNOWN_MODELS`/provider allowlists, `OMO_NATIVE_EVENT_SCHEMAS` + property allowlists, salted `hashSessionId` (sha256 over a persisted 32-byte 0600 salt), `maskProviderAndModel`. |
| `omo-native-component.ts` | Composition root: shared transport factory, capture fan-in gated by `isOmoNativeEventName`, wires session/prompt/tools/turns/notice/parallel-summary registrations. Registration order is load-bearing (see parallel-summary). |
| `omo-native-session.ts` | `session_started` event: reason, os/arch/cpu/memory bucket, provider and model inventory (masked to known lists or `custom`). Also chains the legacy `recordSenpiDailyActive`. |
| `omo-native-notice.ts` | Once-per-machine `notice-shown` marker + visible one-line disclosure with docs URL and `DO_NOT_TRACK=1` opt-out. |
| `omo-native-prompt.ts` | `prompt_submitted`: ultrawork classification, buckets for length and ordinal, suppression reasons. Raw prompt text never leaves the process. |
| `omo-native-tools.ts` | `skill_loaded` (builtin skills only, path-checked against the shipped skills root), `delegation_started`, `feature_used` (deduped per session). |
| `omo-native-turns.ts` | `turn_completed` from assistant `turn_end`: token and cost numbers, provider/model masked via `maskProviderAndModel`. |
| `omo-native-parallel.ts` / `wave-assembler.ts` | Tool-execution concurrency observation. Waves are interval-graph connected components with `spanMs`, bounded by `MAX_TRACKED_CALLS` (2000). Timestamps are handler-entry stamps because Senpi tool events carry none. |
| `omo-native-eval.ts` / `eval-cell-correlation.ts` | Strictly parses Senpi `senpi.eval.execution` v1 payloads into fixed scalar rollups and correlates `cellId` to the outer eval/session without retaining names, args, paths, or previews. Detached correlation survives the outer end and clears on event or session teardown. |
| `omo-native-parallel-summary.ts` | `parallelism_summary`, exactly once per session at `session_shutdown`; owns its registration order versus the session client and registry teardown. |
| `eval-classifier.ts` / `savings-math.ts` | Wave bucketing (`eval_only`/`non_eval`/`mixed`, never folded together) and span-based savings math (modeled vs labeled upper bound, negatives not clamped). |
| `parallelism-schema.ts` | Privacy schema for `parallelism_summary`, including historical `parallelism_v1` and emitted `parallelism_v2` fixed fields. |
| `delegation-schema.ts` / `category-config-schema.ts` | Privacy schemas for `delegation_completed` and `category_config`, re-exported into `OMO_NATIVE_EVENT_SCHEMAS`. |
| `delegation-projection.ts` | Pure `TaskRecord` + terminal edge + steer counts -> `delegation_completed` property bag. Explicit scalar allowlist; every free-text record field is excluded by construction and pinned by an exact-key-set test. |
| `omo-native-delegation.ts` | Subscribes the task terminal-observer ledger, dedupes on `(task_seq, run_epoch)`, counts `steered`/`steer_queued` jsonl lines for the current epoch, and captures `delegation_completed`. Fire-and-forget, unsubscribes on dispose. |
| `omo-native-category-config.ts` | Captures a `category_config` snapshot per `config_generation`; a generation is spent only when the canonical exportable map changed. Custom category and model names never leave the machine. |
| `model-vocabulary.ts` | `KNOWN_MODELS` / provider vocabulary so every shipped fallback-chain rung masks to itself, not `custom`. |
| `schema-doc.test.ts` | Pins the generated schema block in `docs/reference/senpi-telemetry.md` against `OMO_NATIVE_EVENT_SCHEMAS`. |
| `telemetry.test-support.ts` | Recorded transport factory, fixed clock, fake os provider for tests. |

## Event model

- Legacy product: single event `omo_senpi_daily_active`, reason `session_start`. Distinct id is `sha256("omo-senpi:" + hostname)` (telemetry-core `machine-id.ts`); once-per-UTC-day dedupe lives in the state dir.
- `omo-native` product: `daily_active`, `session_started`, `prompt_submitted`, `turn_completed`, `skill_loaded`, `delegation_started`, `delegation_completed`, `category_config`, `feature_used`, `parallelism_summary`. Every event is schema-declared from `product-identity.ts`; properties outside the allowlist do not ship. Session ids are salted sha256 hashes, salt local to the machine.
- `parallelism_summary` remains one event per session. V2 adds eval event-bus availability, accepted/rejected execution counts, nested status/duration totals, outer eval wrapper counts, and mixed-wave direct counts. Existing non-eval wave and savings formulas are unchanged.
- Free-form strings are masked to closed vocabularies: unknown providers/models/skills/agents become `custom` or are dropped. Numeric properties are bucketed where cardinality matters.

## Privacy and opt-out

- Env opt-outs (telemetry-core `env.ts`): `DO_NOT_TRACK`, `OMO_DISABLE_POSTHOG` / `OMO_SENPI_DISABLE_POSTHOG` (`1|true|yes`), `OMO_SEND_ANONYMOUS_TELEMETRY` / `OMO_SENPI_SEND_ANONYMOUS_TELEMETRY` (`0|false|no|yes`). Config gate: `isOmoTelemetryEnabled` from `omo-config-core`.
- Never captured: prompt text, file paths, hostnames in clear, raw session ids, custom model or provider names.
- API keys come from `POSTHOG_API_KEY` or the write-only defaults named in `product-identity.ts` / telemetry-core constants; do not duplicate key literals elsewhere.
- First-run disclosure notice is mandatory and marker-gated; it fires only when telemetry is actually enabled.

## Delegation telemetry invariants

- **Observer ledger.** Terminal edges arrive through the shared ledger in `../task/terminal-observers.ts` (`globalThis` + `Symbol.for`, one instance across re-registration), fed by the status-edge store wrapper that watches every write path (`save`/`replace`/`mutate`/`transition`), so reconciliation-written `lost` records are observed too. Observer callbacks are individually try/caught; a throwing observer never affects the store result or task liveness. `createOmoNativeDelegationCapture` subscribes at register and must unsubscribe on dispose, otherwise each session switch stacks another observer writing into a dead client.
- **Session-hash ownership.** Delegation events hash `record.parent_session_id`, the session that owns the task, and pass that hash explicitly. Only the `session_start` path may set `state.sessionHash`; a resumed old task must never redirect the live session's events by mutating shared state.
- **Child-process gate.** Native telemetry never emits from senpi-task child or team-member processes: `components/task/index.ts` returns early on `isTeamMemberProcess()`, and in-process children load zero extensions (`child-loader.ts`). This is a test-pinned invariant; a child turn must never produce a parent delegation or turn event.

## Conventions

- Fire-and-forget everywhere: capture failures surface once through the diagnostics callback or debug log, never to the user, never as a thrown error.
- New events require a schema entry + allowlist in `product-identity.ts`, a doc regeneration (`schema-doc.test.ts` fails otherwise), and bucketing for any unbounded value.
- Tests inject `env`, `now`, `osProvider`, `stateDir`, and `transportFactory`; no test touches the network or the real agent home.

## Anti-patterns

- Do not emit per-turn variants of session-scoped events (`parallelism_summary` is once per session by design).
- Do not fold `mixed` waves into `non_eval` or clamp negative savings; both hide measurement anomalies.
- Do not add eval-internal calls to top-level waves or infer nested concurrency/savings from aggregate duration sums; the producer event does not carry the required interval graph.
- Do not add properties outside the declared schema, log raw session ids, or widen the timeout so telemetry can delay `session_start`.
