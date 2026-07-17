# PR #6043 Twenty-Fifth Review Repair

Date: 2026-07-17
Reviewed head: `a81ffd193c6eeb45e8b43d1cb869f86c2f09e1a8`
Runtime source: `0ae2adf79990af78f409e6809fb3ba93af0908a5`
Integrated base: `5ef852a32c2c433386eb009bd92ca7c07359d0e6`

## Findings And Repair

The third fresh exact-head review found three independent concurrency blockers:

1. Two overlapping internal aborts shared one boolean marker. If the newer
   abort failed while the older abort still owned cancellation, the failure
   deleted the older operation's marker and exposed its terminal event as an
   external cancellation.
2. Reservation release checked only the completion-time session owner. An
   older abort could therefore delete a newer replacement reservation after
   the awaited HTTP request completed (an ABA race).
3. The sibling model-fallback continuation controller did not request throwing
   SDK abort semantics and treated a resolved non-2xx error union as success,
   releasing its reservation and dispatching another prompt without owning
   cancellation.

The repair counts internal abort ownership per session while retaining the
existing set as the observation surface, captures the prompt reservation token
before awaiting abort and releases only the same token, and makes model-fallback
abort fail closed on both thrown and resolved SDK errors before any release or
continuation dispatch.

## Failing-First Proof

- Overlapping abort ownership: the focused runtime test reported 7 pass and 1
  fail before the helper existed; the newer failed abort erased the older
  successful operation's marker.
- Reservation ABA: the same focused file reported a second failure because the
  replacement `runtime-fallback:new-owner` reservation became `undefined`.
- Sibling SDK error: the focused model-fallback test reported 0 pass and 1 fail
  because `throwOnError` was false before prompt-dispatch behavior could be
  accepted.

The ignored `.debug-journal.md` records the deterministic red observations and
was intentionally excluded from the durable evidence commit.

## Exact-Source Verification

- Focused regressions: 25 pass, 0 fail across 2 files.
  Artifact: `twenty-fifth-exact-focused-regressions.txt`.
- Runtime-fallback suite: 298 pass, 0 fail across 46 files.
  Artifact: `twenty-fifth-exact-runtime-fallback-suite.txt`.
- Model-fallback and shared prompt gate: 104 pass, 0 fail across 12 files.
  Artifact: `twenty-fifth-exact-model-fallback-suite.txt`.
- Main-session lifecycle/state: 50 pass, 0 fail across 3 files.
  Artifact: `twenty-fifth-exact-session-lifecycle-suite.txt`.
- OpenCode adapter typecheck passed. The bundled TypeScript no-excuse helper
  reported no violations in all 13 changed files. Biome 2.4.16 completed with
  formatter and assist disabled and only 11 pre-existing informational
  `useLiteralKeys` notices. Diff and pure-LOC integrity passed, including the
  250-line ceiling for `first-prompt-watchdog.ts`.
  Artifacts: `twenty-fifth-exact-omo-opencode-typecheck.txt`,
  `twenty-fifth-exact-no-excuse.txt`, `twenty-fifth-exact-biome.txt`, and
  `twenty-fifth-exact-integrity.txt`.
- The mandatory OpenCode harness self-check passed with isolated HOME/XDG
  cleanup. Artifact: `twenty-fifth-exact-opencode-harness-self-check.txt`.
- A loopback HTTP 404 exercised the real pinned `@opencode-ai/sdk@1.15.13`
  through both repaired production controllers. Runtime abort returned false,
  failed ownership was cleared, the exact reservation token remained current,
  model-fallback issued zero prompts, and no continuation remained in flight.
  Artifacts: `run-sdk-abort-boundary.ts` and
  `twenty-fifth-exact-sdk-abort-boundary.txt`.
- Production-duration OpenCode QA loaded the exact local plugin source and
  observed two active roots, silent older-root fallback, deletion restoration,
  no fallback watchdog re-arm, later external user cancellation, and an
  unchanged real OpenCode database. Artifacts:
  `twenty-fifth-exact-live-watchdog-run.txt`,
  `twenty-fifth-exact-live-plugin-watchdog.txt`,
  `twenty-fifth-exact-live-fake-provider.txt`,
  `twenty-fifth-exact-live-sse-events.jsonl`,
  `twenty-fifth-exact-live-root-state.jsonl`, and
  `twenty-fifth-exact-live-isolation-receipt.txt`.

## Why It Is Enough

The deterministic tests force each interleaving without timers, the SDK probe
binds the repaired branches to the actual generated client contract, and the
isolated live harness covers the successful transport and user-visible
watchdog lifecycle. Broad runtime, prompt-gate, lifecycle, type, lint, strict
rule, and integrity gates cover adjacent ownership and cleanup regressions.

## What Was Omitted

Transient candidate outputs, raw environment dumps, credentials, auth headers,
temporary sandbox paths, and unrelated logs are omitted. The live harness uses
only fixed loopback credentials and sanitizes session IDs and local paths in
the committed plugin, SSE, and root-state artifacts.
