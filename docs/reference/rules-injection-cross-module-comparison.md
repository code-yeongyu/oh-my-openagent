# Rules Injection Modules — Cross-Module Comparison Report

Comparison and porting record for the three rule injection implementations
maintained out of `/Users/yeongyu/local-workspaces`:

- **codex-rules** — Codex hook plugin (`codex-plugins/plugins/codex-rules`, repo `code-yeongyu/codex-rules`, branch `main`).
- **pi-rules** — pi-mono extension (`pi-extensions/pi-rules`, repo `code-yeongyu/pi-rules`, branch `main`).
- **omo rules-injector** — opencode plugin path (`omo/src/hooks/rules-injector`, repo `code-yeongyu/oh-my-openagent`, branch `dev`).

## 0. Latest pushed commits

| Repo | Branch | HEAD | Note |
| --- | --- | --- | --- |
| codex-rules | main | `9f49c68 fix(hooks): keep compacted channels independent` | unchanged in this round |
| pi-rules | main | `9789f12 perf(rules): skip unchanged dynamic targets via fingerprint` | new |
| omo | dev | `fbe423a2d feat(rules-injector): hydrate dedup cache from session transcript` | new |

Installation state after the porting round:

- **omo** — `~/.bun/install/global/node_modules/oh-my-opencode` is a symlink to the local workspace, so `bun run build` immediately publishes the rebuilt `dist/`. Verified via `grep -c transcriptHydration dist/index.js` → 6.
- **codex-rules** — `node scripts/install-local.mjs ...` was rerun and the cache at `~/.codex/plugins/cache/code-yeongyu-codex-plugins/codex-rules/0.1.0` was refreshed.
- **pi-rules** — pi-mono consumes the package source directly; no separate install step.

## 1. Performance baseline

The only repo with its own benchmark harness is codex-rules
(`scripts/bench-codex-rules.mjs`). Results from the latest run on commit
`9f49c68` (40 iterations, 5 warmup, 120 rules, 80 distinct targets, 240 repeat
targets):

| Scenario | median ms | min | max | counters |
| --- | --- | --- | --- | --- |
| duplicate-targets | 7.12 | 5.66 | 71.21 | findProjectRoot=40, findCandidates=40, readFile=4800 |
| distinct-targets | 200.29 | 52.09 | 467.90 | findProjectRoot=40, findCandidates=40, readFile=4800 |
| hookFastPath repeat-post-tool-use | 2.57 | 2.08 | 5.14 | repeat output bytes = 0 (dedup works) |

A unified cross-module benchmark harness does not yet exist; the other two
modules were validated via their existing unit and integration suites
(243 tests pass on pi-rules, 70 tests pass on omo rules-injector).

## 2. Functional gap matrix (pre-porting)

| Feature | codex-rules | pi-rules | omo rules-injector |
| --- | --- | --- | --- |
| Pre-compaction dedup | persistent JSON + transcript scan | in-memory Set/Map | in-memory Map + persistent JSON |
| Transcript-aware dedup | **YES** | NO (pi-mono SDK does not expose `transcript_path`) | **NO** (was a real gap) |
| Dynamic target fingerprinting | **YES** | NO (was a real gap) | NO (lazy on tool output instead) |
| Persistent session cache | YES (per-session JSON) | NO (in-process state) | YES (per-session JSON) |
| Post-compact strategy | Independent static / dynamic pending channels | `engine.resetSession(cwd)` (full reset) | `clearSessionState(sessionID)` (full reset) |
| Multiple injection hooks | SessionStart, UserPromptSubmit, PostToolUse, PostCompact | session_start, session_compact, before_agent_start, tool_result | tool.execute.after only |
| Rule discovery cache | per-call discovery cache + parsed content cache | per-call discovery cache + parsed content cache + match cache | parsed-rule LRU + match decision LRU + scan cache |
| Rule sources implementation | own finder (matches pi-rules layout) | own finder | shared `@oh-my-opencode/rules-engine` workspace package |

## 3. Performance gap matrix (pre-porting)

| Scenario | codex-rules | pi-rules | omo |
| --- | --- | --- | --- |
| Hot path: identical target repeats | fingerprint matches → skip parse + match (~2.5 ms) | always re-discovers, but match cache absorbs match cost | parsed-rule cache + match decision cache absorb match cost |
| Cold start with N rules | ~200 ms for 120 rules across 80 distinct targets | comparable | comparable |
| Transcript scan cost on first hook | rule body 2KB prefix + path marker search (cheap) | n/a — no transcript exposure | **previously absent**, now added in this round |
| Post-compaction first hook | only the pending channel re-injects | full reset, next hook re-injects everything | clear cache, next file tool re-injects everything lazily |

## 4. Porting decisions (best-of-best, this round)

| Capability | Applied to | Rationale / outcome |
| --- | --- | --- |
| Dynamic target fingerprinting | pi-rules | Skips discovery + parse + match entirely when the on-disk fingerprint of every candidate is unchanged. Mirrors codex-rules' `fingerprintDynamicTargets` + `dynamicTargetCacheKey` + `fileStatFingerprint`. A new `EngineDeps.fileFingerprint?` injection keeps tests deterministic when fixtures use synthetic paths. |
| Transcript-aware dedup | omo rules-injector | A fresh process whose persistent JSON has been deleted, or a session whose cache has been cleared by `session.compacted`, can still detect prior `[Rule: <relativePath>]` banners that survive in the transcript and avoid emitting duplicates. Lazy (one fetch per session per process), capped (200 messages / 1 MB scanned), fails open on transport errors, and concurrent calls share a single in-flight promise. |
| Transcript-aware dedup → pi-rules | not applied | pi-mono `ToolResultEvent` does not carry `transcript_path`. Porting requires upstream SDK changes. Net loss is small because pi-rules is in-process and rarely sees the "cache vanished mid-session" case codex-rules / omo can hit. |
| Dynamic target fingerprinting → omo | deferred | omo already has parsed-rule LRU + match-decision LRU caches that absorb most hot-path work. Adding a third fingerprint layer is low ROI today. Tracked as future work in section 7. |
| Post-compact channel pending → pi-rules / omo | not applied | Both run hooks sequentially in-process; the codex-rules channel-pending state is specifically a workaround for Codex's out-of-process hook model. Full reset works correctly for both pi-rules and omo. |

## 5. Implementation details

### pi-rules (`9789f12 perf(rules): skip unchanged dynamic targets via fingerprint`)

- New `Engine` public methods: `fingerprintDynamicTargets`, `isDynamicTargetFingerprintCurrent`, `commitDynamicTargetFingerprints`. `DynamicTargetFingerprint` interface exported.
- New session field: `SessionState.dynamicTargetFingerprints: Map<string, string>`. Cleared by `clearSession` so `resetSession` already covers compaction.
- New optional dep: `EngineDeps.fileFingerprint?: (filePath: string) => string`. Default: `statSync(path, { bigint: true })` mtimeNs/ctimeNs/size; injectable for tests where fixtures use synthetic paths.
- `src/index.ts` `tool_result` handler now computes fingerprints first, calls `commitDynamicTargetFingerprints` always, and bypasses `loadDynamicRules` entirely when every target is current.
- Tests: 243/243 vitest pass, biome clean, tsgo typecheck clean. New tests added in `test/engine.test.ts`:
  - fingerprint stays "current" after commit
  - fingerprint flips when underlying file fingerprint changes
  - `resetSession` clears `dynamicTargetFingerprints`

### omo rules-injector (`fbe423a2d feat(rules-injector): hydrate dedup cache from session transcript`)

- New file `src/hooks/rules-injector/transcript-hydration.ts` (~140 LOC) exposing `createTranscriptHydrationStore({ client })` with three methods: `hydrateSession(sessionID)`, `getHydratedRelativePaths(sessionID)`, `clearSession(sessionID)`.
- Hydration scans the last `200` messages and at most `1_000_000` characters of text per session, matches `\[Rule: <relativePath>\]\n\[Match: <reason>\]` exactly once per session per process, and joins concurrent calls onto a single in-flight promise. Transport errors fail open so injection never blocks.
- New optional dep `transcriptHydration?: TranscriptHydrationHook` on `createRuleInjectionProcessor`. Existing tests that do not pass it keep their old behavior, which keeps all 70 rules-injector tests green.
- `hook.ts` wires `createTranscriptHydrationStore({ client: ctx.client })` into the processor and also calls `transcriptHydration.clearSession(sessionID)` on `session.deleted` and `session.compacted` events so post-compaction reinjection still works.
- Tests added: `transcript-hydration.test.ts` (7 cases — marker scan, empty transcript, single-flight, concurrent calls, error fallback, clearSession, embedded markers) and 2 integration cases in `injector.test.ts` (hydrated path absorbs the duplicate; unrelated hydrated path does not block legitimate injection). bun test totals: rules-injector 70/70 green, typecheck clean, biome clean.

### codex-rules (no changes this round)

codex-rules already implements both transcript-aware dedup and post-compact channel pending. The baseline benchmark was rerun on commit `9f49c68` and the local install cache was refreshed.

## 6. Verification summary

| Repo | Tests | Typecheck | Lint | Build | Install | Push |
| --- | --- | --- | --- | --- | --- | --- |
| codex-rules | 59/59 vitest (prior commit verified), bench rerun | tsc OK | biome OK | tsc -p tsconfig.build.json OK | `~/.codex/plugins/cache/...` refreshed | up to date |
| pi-rules | 243/243 vitest | tsgo OK | biome OK | n/a (source-import package) | n/a | pushed `9789f12` |
| omo | rules-injector 70/70 bun test | tsgo OK (workspace + packages) | biome OK | `bun run build` (dist/index.js 4.53 MB) | global symlink picks up new dist | pushed `fbe423a2d` |

Note: omo's broader hooks test suite still surfaces pre-existing
test-isolation flakiness (the most recent merge on dev is literally named
`fix/test-isolation-cross-test-state-leak`). Each affected file passes when
run alone; the failures are unrelated to the changes in this round.

## 7. Follow-ups intentionally left for later

1. Port dynamic target fingerprinting into omo so cache miss does not re-walk `findRuleFiles` when nothing about the target changed.
2. Author a shared `bench-rules-comparison.mjs` harness that drives each of the three implementations through an identical rule fixture so future regressions can be detected quantitatively.
3. Upstream a PR to pi-mono exposing `transcript_path` (or an equivalent transcript reader) on `ToolResultEvent` so pi-rules can adopt transcript-aware dedup the same way codex-rules and omo do.
4. Resolve the residual cross-suite state leak flakiness in omo's broader hook tests so a full `bun test src/hooks` run is reliably green.
