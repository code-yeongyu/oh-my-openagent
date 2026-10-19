# Native context-mode prompt bridge: verification and host seam

Verified 2026-10-19 on the OpenCode v2 integration lane. Stage only; not activated.

## Behavioral change

The Claude plugin hook loader stamps the plugin name alongside its existing install-root provenance. The v2 facade retains an OMO-internal, context-scoped lookup of the public `ctx.plugin.list()` API. On a user prompt, the bridge checks that catalog only when there are context-mode-sourced prompt hooks. It removes those actions only when the exact native plugin id `context-mode` has `state.status === "active"`.

Other plugins and user settings remain effective. Cached hook configurations are not mutated. Transcript and first-message bookkeeping remain. Unsupported hosts, inactive/error states, and failed catalog lookups retain the legacy bridge. Activation state is not cached: a catalog queried during setup can be empty before activation completes.

When the prompt bridge is disabled, empty, or emptied by native ownership filtering, no session parent lookup is needed. Remaining hooks still receive the original parent-session check, including child-session suppression.

## Reproduction and proof

- RED: active native plugin expected zero dispatcher calls, received one; mixed user/native hooks expected one call, received two. Loader provenance assertions received `undefined` instead of the plugin name.
- GREEN: 164 tests passed across 21 files, 392 assertions; no failures.
- `bun run typecheck`: passed, including root, scripts, and all package checks.
- LSP: no diagnostics on all nine changed TypeScript files.
- Isolated real OpenCode 2.0.32 host, disposable Claude hook scripts, actual plugin catalog and OMO dispatcher: native fixture active dispatched `["user"]`; native absent dispatched `["user", "context-mode"]`. Both commands executed real Node child processes. No paid model or production prompt was used. The fixture advertises the real native plugin identity/status; it does not exercise context-mode's database internals.

## Session lookup: already in process on this host

No replacement API was introduced. The existing path is:

1. `v2/context-facade.ts` adapts V1 `client.session.get({ path: { id } })` to `ctx.session.get({ sessionID })`.
2. OpenCode `packages/plugin/src/promise/adapter.ts` adapts `session.get` to `host.session.get` using the current Effect context.
3. OpenCode `packages/core/src/plugin/host.ts` implements it as `sessions.get(input.sessionID)`.

Runtime proof: with global `fetch` replaced by a throwing sentinel, the existing facade read returned the correct session id with **zero fetch calls**. The same sentinel permitted `ctx.plugin.list()`. Server logs contained no `/api/session` HTTP request from the probe. Thus the earlier description of this v2 parent read as an HTTP self-call is not true of the verified 2.0.32 host.

On hosts that implement public APIs over HTTP, OMO has no supported alternate accessor. Do not reach into private databases or cache parentage indefinitely. The narrow safe alternative implemented here is avoiding the read when the prompt hook has no remaining work.

## Offline CPU profile

Method: Bun 1.3.14 `--cpu-prof`, real loaded OMO bundle, fake host context, isolated home/config/data/temp directories, one quiet setup followed by five concurrent setups. Baseline bundle SHA-256: `b4aa1e07640d3ac3723781fd5c40d659a28a1b98a508b96234172101cd3572b2`.

Final non-repository fixture:

- Import: 460 ms; quiet setup: 386 ms.
- Five concurrent setups: 645, 655, 676, 668, 650 ms.
- Largest loaded-phase event-loop sampling gap: 98 ms, **not five seconds**.
- Inclusive samples across the entire run, counting each named frame once per sample: `createEffectiveAgentSnapshotKey` 205 ms; `fingerprintMany` / `fingerprintTree` 191 ms; `statSync` 95 ms; `isInteractiveBashEnabled` / `Bun.which` 47 ms; `readdirSync` 24 ms. These are aggregate samples, not individual contiguous stalls. Ancestor scanning and shared dependency probes also appeared.
- The 324 ms boundary gap crosses module import and early setup; it is not an isolated setup measurement.
- Profile SHA-256: `d2905c1ae365f4546f42b22c7b879524a700342c89823aed95082b10e4018b26`.

Two earlier fixtures inherited a Git marker, first from the clone and then from the temporary-directory root. They showed synchronous `detectWorktreePath -> execFileSync("git")` samples, but those controls do not represent non-repository chat folders. Moving the fixture outside both repositories and changing the process working directory removed those spawn samples. The existing marker guard is working.

The historical setup freeze occurred under five concurrent conversation turns, not five setup calls. This offline experiment does not recreate the production provider/plugin workload or three-gigabyte heap. It names the observed synchronous work but does not attribute the historical five-second stretch. No item-3 optimization was shipped without a reproduction and toggle proof. Raw profiles and temporary fixtures are removed after the requested task report is recorded.
