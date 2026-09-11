# Persona assets: single definition, process-pinned reads, payload coverage

Change under QA: `packages/memory-core/src/personas/*`, the three persona loaders,
`primeMemoryPersonaAssets` in the memory component, `plugin-artifacts.ts` as the one
required-artifact list, `script/build-omo-native.ts` re-exporting it, and an `omo doctor` report for
engines still running a retired payload. Root cause and timeline: `root-cause.md`.

Compute nodes: unit/typecheck/bundle work on `gorky` (Linux x86_64, Bun 1.4.2 — the CI pin), live
harness QA on `mengmotaMac` (Darwin arm64, real `senpi` CLI). `mengmotaHost` ran no test process.
Both remote trees were namespaced at `/tmp/omo-persona-20260909` and probed for poisoned
`*_PACKAGE_DIR` / `*_CODING_AGENT_DIR` env before use (`NO_POISONED_ENV`).

## What was tested

| Surface | Command | Artifact |
|---|---|---|
| Payload requirement coverage (RED then GREEN) | `bun test script/build-omo-native.test.ts` | `red-payload-requirement.log`, `mutation-payload-requirement.log` |
| Persona read pinned to the process (mutation) | `bun test packages/memory-core/src/personas` | `mutation-persona-cache.log` |
| Registration degrade path | `bun test packages/omo-senpi/src/components/memory/persona-prime.test.ts` | `green-persona-suites.log` |
| Install/packing + asset suites | `bun test packages/omo-senpi/src/install packages/memory-core/src/{personas,recall/assets,reflection/assets} script/build-omo-native.test.ts` | `green-persona-suites.log` |
| Staging manifest lock + persona parity | `bun test packages/omo-senpi/plugin/scripts/build-extension.test.mjs` | `green-persona-suites.log` |
| Committed bundle freshness | `node packages/omo-senpi/plugin/scripts/build-extension.mjs --check` | `green-persona-suites.log` (`FRESHNESS_OK`) |
| Typecheck | `tsgo --noEmit -p` for `memory-core`, `omo-senpi`, `script` | `green-persona-suites.log` (`TYPECHECK_OK`) |
| Live recall gate, real senpi RPC | `bun packages/omo-senpi/scripts/qa/kibitzer-gate-e2e.mjs --scenario all` | `live-gate-e2e.log`, `kibitzer-gate-e2e.json` |
| `omo doctor` retired-payload report | `bun test packages/omo-native/test/doctor-retired-payload.test.ts` + live `omo doctor` | `green-doctor-retired-payload.log`, `doctor-live.log` |

## What was observed

- RED before the fix: the payload requirement test reported `[ "kibitzer-persona.md" ]` unguarded
  (7 pass / 1 fail). GREEN after: 8 pass / 0 fail, and the same test fails again under a mutation
  that drops the gate persona from the derived list.
- The persona cache test fails with the production symptom
  (`ENOENT ... /tmp/persona-cache-*/kibitzer-persona.md`) when the cache write is removed, and passes
  when it is restored — the assertion cannot pass without the behavior it names.
- Suites: 47 pass / 0 fail (install + persona + asset + payload requirement), 13 pass / 0 fail
  (`build-extension.test.mjs`), 12 pass / 0 fail (focused persona + prime + payload requirement).
  `FRESHNESS_OK` and `TYPECHECK_OK` on the CI-pinned toolchain.
- Live gate: `{"ok": true, "total": 20, "failures": []}`. Scenario 1 created a real session
  (`sessionId=01a0852b-ea43-73de-b5e5-d0a4b42d243a`), settled the judge, delivered one nudge for
  `reference/kubernetes-rollouts.md`, produced `runs=1` with `stopReason=stop` and recorded
  **no failed gate entry**; scenario 2 still reports a provider 500 as `child_failed` with a
  sanitized reason and `runId=a2b8d7e4-3506-4e00-be1a-49c4bc42e126`. The driver routes judge traffic by
  detecting the Kibitzer persona in the request body, so two judge requests prove the persona was
  loaded and sent as the child's system prompt.
- Isolation: the driver builds its own sandbox (`SENPI_CODING_AGENT_DIR`, `OMO_MEMORY_HOME`, `HOME`
  under `/private/var/folders/.../omo-senpi-qa-*`), asserts no real agent dir leaks in, and reported
  `cleanup: pid 93463 exited, server closed, sandbox removed`. The real `~/.senpi/agent` and
  `~/.omo/agent` were never used as the sandbox.

## Why this is sufficient

The failing behavior was a child launch that reads a fixed filename from a mutable install tree. The
cache mutation proves the read now happens once per process; the prime tests prove an unreadable
asset degrades to one named warning instead of failing every later launch; the payload tests prove the
shipped `omo-ai` payload cannot lose an asset the runtime resolves; and the live gate proves the whole
path still produces a nudge through the real engine with the real persona in the request.

## What was omitted

No provider credentials, tokens, auth headers, env dumps, or session transcripts are included: the
live driver runs against a mock completions server, and the captured logs carry only sandbox paths,
run ids, and check verdicts. Sessions already running a retired bundle are out of scope for a code
fix (see `root-cause.md`); `omo doctor` now names them instead.
