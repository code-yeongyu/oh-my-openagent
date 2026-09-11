# Kibitzer fire hardening: silent judge completion, best-effort artifacts, persona_unavailable, runtime prime

Change under QA (issue #8052, closes #7963): `packages/omo-senpi/src/components/memory/kibitzer-nudge-tool.ts`
(`terminate` at the cap), `kibitzer-judge-outcome.ts` (empty-response-twice rule), `kibitzer-judge-run.ts`
(persona read first, best-effort artifacts, memoized runtime load), `kibitzer-judge-spec.ts` (persona text
passed in), `kibitzer-runner.ts` (`persona_unavailable`, `loadPersona` QA seam), new
`kibitzer-task-runtime.ts`, `persona-prime.ts` (runtime module primed beside the personas), and the
regenerated `plugin/extensions/omo.js`.

Compute node: `mengmotaHost` (Darwin arm64, Bun 1.4.2 - the CI pin). Only scoped test files ran here; no
full `bun test`.

## What was tested

| Surface | Command | Artifact |
|---|---|---|
| Silent judge -> completed/empty, not child_failed (RED then GREEN) | `bun test .../kibitzer-judge-outcome.test.ts .../kibitzer-nudge-tool.test.ts .../kibitzer-runner-completion.test.ts` | `red-silent-judge.log`, `green-kibitzer-suites.log` |
| Run-dir artifact writes best-effort (RED then GREEN) | `bun test .../kibitzer-runner-completion.test.ts -t "artifact writes reject"` | `red-run-artifacts.log`, `green-kibitzer-suites.log` |
| Missing persona -> `persona_unavailable` (RED then GREEN) | `bun test .../kibitzer-runner-completion.test.ts -t "persona asset missing"` | `red-persona-unavailable.log`, `green-kibitzer-suites.log` |
| `#omo-task-runtime` primed at registration (RED then GREEN) | `bun test .../persona-prime.test.ts .../kibitzer-task-runtime.test.ts` | `red-task-runtime-prime.log`, `green-kibitzer-suites.log` |
| All kibitzer-*, persona-prime, in-process child, recall-notice, facts launch suites | `bun test packages/omo-senpi/src/components/memory/kibitzer-*.test.ts persona-prime.test.ts in-process-memory-child.test.ts recall-notice.test.ts facts-in-process-launch.test.ts` | `green-kibitzer-suites.log` (224 pass / 0 fail) |
| Typecheck | `bunx tsgo --noEmit -p packages/omo-senpi/tsconfig.json` | `green-kibitzer-suites.log` (`TYPECHECK_OK`) |
| Committed bundle freshness | `node packages/omo-senpi/plugin/scripts/build-extension.mjs --check` | `green-kibitzer-suites.log` (`FRESHNESS_OK`) |
| Live persistent-failure notice policy, real senpi RPC + mock provider | `bun packages/omo-senpi/scripts/qa/kibitzer-persistent-failure-e2e.mjs --evidence-dir <this dir>` | `kibitzer-persistent-failure-e2e.log`, `kibitzer-persistent-failure-e2e.json` |
| Live recall gate (nudge delivered / provider 500 -> child_failed), real senpi RPC | `bun packages/omo-senpi/scripts/qa/kibitzer-gate-e2e.mjs --evidence-dir <this dir>` | `kibitzer-gate-e2e.log`, `kibitzer-gate-e2e.json` |

## What was observed

- RED, silent judge: a scripted child that nudged once and then settled with
  `Model returned an empty response twice` came back `status: "failed", cause: "child_failed",
  reason: "Model returned an empty response twice"` - the exact user-visible failure of #7963 - and the
  zero-nudge variant came back `failed` instead of `empty`. The nudge tool result carried no `terminate`
  at the cap. GREEN: `nudged` with the accepted path, `empty` with none; `terminate: true` at the cap
  (accepting and rejecting call), absent below it.
- RED, artifacts: with `recall/runs` a regular file (so every write under the run dir rejects on every
  platform and for every user) the fire ended `session_create_failed` with the `ENOTDIR ... mkdir` reason.
  GREEN: `nudged`, one `kibitzer gate run artifacts skipped` warning carrying the runId, no
  session-creation warning.
- RED, persona: a `loadPersona` that throws ENOENT produced `session_create_failed` (the session was
  attempted without the persona). GREEN: `persona_unavailable`, reason begins with `kibitzer-persona.md:`,
  zero sessions created.
- RED, prime: `MEMORY_PRIME_TARGETS` did not exist and a promise-returning target that rejected was
  ignored (`unavailable = []`, unhandled rejection). GREEN: the target list is the four personas plus
  `#omo-task-runtime`; a rejecting import is awaited and reported once as
  `omo-senpi memory boot asset unavailable`; synchronous persona reads still complete before the prime
  returns; the loader imports once and does not cache a rejection.
- Scoped suites: 224 pass / 0 fail across 31 files. `TYPECHECK_OK`, `FRESHNESS_OK` on Bun 1.4.2.
- Live persistent-failure driver: `ok: true`, 18/18 checks. Seven mock-provider outages and one
  silent judge success (turn 5, `outcome.status === "completed"`) produced diagnostic records
  `1,2,3,4,4,5,6,7` and notices only at streaks of 3 (`notification-thresholds: [3, 3]`) - the notice
  policy of PR #8033 is unchanged by this PR.
- Live gate driver: `ok: true`, 20/20 checks. s1 delivered one nudge for
  `reference/kubernetes-rollouts.md` (`stopReason=stop`, `runs=1`, `candidates=true`, no failed gate
  entry); s2 still reports a provider 500 as `child_failed` with a sanitized reason and a runId.
- Isolation: both drivers built their own sandbox under `/private/var/folders/.../omo-senpi-qa-*`,
  asserted no real agent dir leaked in, and reported `sandbox removed`. `~/.senpi/agent/settings.json`
  digest before and after: identical (`real-senpi-settings-before.sha`, `real-senpi-settings-after.sha`).

## Why this is sufficient

Each numbered Expected-behavior item of #8052 has a test that fails without the change it names and
passes with it, at the classifier/tool level and at the runner level through the real senpi-task
InProcessRunner with a fake session. The live drivers prove the whole path still produces a nudge and
still reports a genuine provider failure through the real engine with the regenerated bundle, and that
the notice threshold policy is untouched.

## What was omitted

The `terminate` hint's effect inside the agent loop is exercised by the shipped pi-agent-core
(`shouldTerminateToolBatch`) and is not re-tested here; the mock provider (openai-completions) does not
trigger senpi's empty-assistant recovery, so the live drivers exercise the silent-stop path through
`completion: "turn"`, and the empty-response-twice path is covered by the runner-level tests. No
credentials, tokens, auth headers, env dumps, or session transcripts are included.
